"""Matching benchmark (blueprint W8, §24.2): B0 exact keys, B1 fuzzy names, and the Samanvay cascade, on the
fixed-seed synthetic set. Uses the production resolver and pair-scoring functions; nothing is tuned per run.

Run: python -m app.ml.benchmark  (writes ml/benchmark/results.json and labels.json at the repository root)
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import random
import time
import uuid
from collections import defaultdict
from pathlib import Path

import numpy as np
from rapidfuzz import fuzz, process

from app.ml.synthetic import SEED, Dataset, SynComplaint, build_dataset
from app.modules.institution.resolver import InstCandidate, InstQuery, rank
from app.modules.matching import scoring
from app.modules.matching.normalize import (
    detect_language,
    extract_entities,
    extract_refs,
    normalize_name,
    similarity_text,
)
from app.modules.matching.similarity import NgramBackend
from app.reference_data import compat_matrix

ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = ROOT / "ml" / "benchmark"
CITY_PROVIDED = 0.7
POSITIVE_TYPES = {"D", "P", "R"}
KINDS = ["dup_multichannel", "cpgrams_forward", "paraphrase", "hindi_english"]


def _uuid(pid: str) -> uuid.UUID:
    return uuid.UUID(hashlib.md5(pid.encode()).hexdigest())  # noqa: S324 - deterministic test ids, not security


def _hmac(phone: str | None) -> str | None:
    return hashlib.sha256(f"p:{phone}".encode()).hexdigest() if phone else None


class MemoryResolver:
    def __init__(self, ds: Dataset) -> None:
        self.cands: list[InstCandidate] = []
        self.choices: list[str] = []
        self.owner: list[int] = []
        for inst in ds.institutions:
            c = InstCandidate(
                id=_uuid(inst.permanent_id),
                permanent_id=inst.permanent_id,
                name=inst.name,
                name_norm=normalize_name(inst.name),
                city=inst.city,
                district=inst.district,
                state=inst.state,
                pin=inst.pin,
                address=inst.address,
                region_id=inst.region_id,
                trust_name=inst.trust_name,
                aliases_norm=[normalize_name(a) for a in inst.aliases],
            )
            idx = len(self.cands)
            self.cands.append(c)
            for s in [c.name_norm, *c.aliases_norm]:
                self.choices.append(s)
                self.owner.append(idx)
        self.by_pid = {c.permanent_id: c for c in self.cands}

    def resolve(self, q: InstQuery):
        if q.permanent_id and q.permanent_id in self.by_pid:
            return rank(q, [self.by_pid[q.permanent_id]])
        qn = normalize_name(q.name)
        hits = process.extract(qn, self.choices, scorer=fuzz.token_set_ratio, limit=60)
        seen, cands = set(), []
        for _, _, i in hits:
            o = self.owner[i]
            if o not in seen:
                seen.add(o)
                cands.append(self.cands[o])
            if len(cands) >= 25:
                break
        return rank(q, cands)


def build_views(ds: Dataset, seed: int = SEED):
    rng = random.Random(seed + 1)
    resolver = MemoryResolver(ds)
    views: dict[str, scoring.CaseView] = {}
    resolutions = {}
    for c in ds.complaints:
        text = f"{c.subject}\n{c.body}"
        refs = extract_refs(text)
        q = InstQuery(
            name=c.institution_text,
            city=c.city_text if rng.random() < CITY_PROVIDED else None,
            permanent_id=refs["permanent_ids"][0] if refs["permanent_ids"] else None,
        )
        res = resolver.resolve(q)
        resolutions[c.key] = res
        top = res.candidates[0] if res.candidates else None
        cpg = c.source_ref if c.channel == "CPGRAMS" else None
        views[c.key] = scoring.CaseView(
            id=uuid.UUID(int=int(c.key[1:])),
            case_no=c.key,
            institution_id=res.institution.id if res.status == "RESOLVED" and res.institution else None,
            probable_institution_id=top.candidate.id if top and top.probability >= 0.6 else None,
            category_code=c.category,
            status="UNDER_EXAMINATION",
            holding_unit_id=_uuid(c.unit),
            received_on=c.received_on,
            complainant_hmac=_hmac(c.complainant_phone),
            hard_refs=scoring.hard_refs_of(refs, cpg, None, None),
            entities=extract_entities(text),
            text=text,
            language=detect_language(text),
            sim_text=similarity_text(
                text, [c.institution_text, res.institution.name if res.institution else None], [c.city_text]
            ),
        )
    return views, resolutions, resolver


def candidate_pairs(ds: Dataset, views: dict[str, scoring.CaseView]) -> set[tuple[str, str]]:
    blocks: dict[str, list[str]] = defaultdict(list)
    for c in ds.complaints:
        v = views[c.key]
        keys = set()
        if v.institution_id:
            keys.add(f"i:{v.institution_id}")
        if v.probable_institution_id:
            keys.add(f"i:{v.probable_institution_id}")
        if v.complainant_hmac:
            keys.add(f"h:{v.complainant_hmac}")
        keys |= {f"r:{h}" for h in v.hard_refs}
        for k in keys:
            blocks[k].append(c.key)
    pairs = set()
    for members in blocks.values():
        for i, a in enumerate(members):
            for b in members[i + 1 :]:
                if abs((views[a].received_on - views[b].received_on).days) <= 365:
                    pairs.add(tuple(sorted((a, b))))
    return pairs


def _prf(pred: set, truth: set) -> dict:
    tp = len(pred & truth)
    p = tp / len(pred) if pred else 0.0
    r = tp / len(truth) if truth else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return {
        "precision": round(p, 3),
        "recall": round(r, 3),
        "f1": round(f, 3),
        "predicted": len(pred),
        "true_positives": tp,
    }


def baselines(ds: Dataset, resolver: MemoryResolver) -> tuple[set, set]:
    exact_names = {c.name_norm: c.permanent_id for c in resolver.cands}
    names = list(exact_names)
    b0_inst, b1_inst = {}, {}
    for c in ds.complaints:
        refs = extract_refs(c.body)
        qn = normalize_name(c.institution_text)
        pid = refs["permanent_ids"][0] if refs["permanent_ids"] else exact_names.get(qn)
        b0_inst[c.key] = pid
        hit = process.extractOne(qn, names, scorer=fuzz.token_set_ratio)
        b1_inst[c.key] = pid or (exact_names[hit[0]] if hit and hit[1] >= 90 else None)

    def pairs(inst_of: dict) -> set:
        groups: dict[tuple, list[SynComplaint]] = defaultdict(list)
        for c in ds.complaints:
            if inst_of[c.key]:
                groups[(inst_of[c.key], c.category)].append(c)
        out = set()
        for members in groups.values():
            for i, a in enumerate(members):
                for b in members[i + 1 :]:
                    if abs((a.received_on - b.received_on).days) <= 90:
                        out.add(tuple(sorted((a.key, b.key))))
        return out

    return pairs(b0_inst), pairs(b1_inst)


def fit_platt(scores: np.ndarray, labels: np.ndarray, iters: int = 50) -> tuple[float, float]:
    a, b = 1.0, -4.0
    for _ in range(iters):
        z = np.clip(a * scores + b, -30, 30)
        p = 1 / (1 + np.exp(-z))
        g = np.array([np.sum((p - labels) * scores), np.sum(p - labels)])
        w = p * (1 - p) + 1e-9
        h = np.array([[np.sum(w * scores * scores), np.sum(w * scores)], [np.sum(w * scores), np.sum(w)]])
        step = np.linalg.solve(h + 1e-6 * np.eye(2), g)
        a, b = a - step[0], b - step[1]
        if np.max(np.abs(step)) < 1e-7:
            break
    return float(a), float(b)


def ece(probs: np.ndarray, labels: np.ndarray, bins: int = 10) -> float:
    total, err = len(probs), 0.0
    for i in range(bins):
        lo, hi = i / bins, (i + 1) / bins
        m = (probs >= lo) & (probs < hi if i < bins - 1 else probs <= hi)
        if m.any():
            err += m.sum() / total * abs(probs[m].mean() - labels[m].mean())
    return round(float(err), 4)


def calibrate(seed: int, backend) -> dict:
    """Platt parameters fitted on an independent synthetic draw, so the reported seed is never used for fitting."""
    ds = build_dataset(seed)
    views, _, _ = build_views(ds, seed)
    if hasattr(backend, "vectors"):
        for v, vec in zip(views.values(), backend.vectors([v.sim_text or v.text for v in views.values()]), strict=True):
            v.vector = vec
    compat = compat_matrix()
    truth = {tuple(sorted((a, b))) for a, b, _ in ds.positives}
    pairs = sorted(candidate_pairs(ds, views))
    s = np.array([scoring.score_pair(views[a], views[b], compat, backend, {}).score for a, b in pairs])
    y = np.array([1.0 if p in truth else 0.0 for p in pairs])
    a, b = fit_platt(s, y)
    return {"a": round(a, 4), "b": round(b, 4), "fitted_on_seed": seed, "backend": backend.name}


def run(seed: int = SEED, backend=None, write: bool = True) -> dict:
    started = time.perf_counter()
    ds = build_dataset(seed)
    views, resolutions, resolver = build_views(ds, seed)
    backend = backend or NgramBackend()
    if hasattr(backend, "vectors"):
        vecs = backend.vectors([v.sim_text or v.text for v in views.values()])
        for v, vec in zip(views.values(), vecs, strict=True):
            v.vector = vec
    compat = compat_matrix()
    truth = {tuple(sorted((a, b))) for a, b, _ in ds.positives}
    kind_of = {tuple(sorted((a, b))): k for a, b, k in ds.positives}
    neg_kind = {tuple(sorted((a, b))): k for a, b, k in ds.negatives}
    by_key = {c.key: c for c in ds.complaints}

    pairs = candidate_pairs(ds, views)
    params = calibrate(seed + 1, backend)
    scored = {}
    for a, b in pairs:
        scored[(a, b)] = scoring.score_pair(views[a], views[b], compat, backend, params)
    pred = {k for k, s in scored.items() if s.link_type in POSITIVE_TYPES}
    b0, b1 = baselines(ds, resolver)

    def by_kind(pred_set: set) -> dict:
        out = {}
        for kind in KINDS:
            t = {p for p in truth if kind_of[p] == kind}
            out[kind] = round(len(pred_set & t) / len(t), 3) if t else None
        return out

    def neg_fp(pred_set: set) -> dict:
        out = {}
        for kind in ("neg_other_matter", "neg_sibling"):
            t = {p for p, k in neg_kind.items() if k == kind}
            out[kind] = round(len(pred_set & t) / len(t), 3) if t else None
        return out

    def hindi(pred_set: set) -> dict:
        t = {p for p in truth if any(by_key[k].language == "hi" for k in p)}
        pr = {p for p in pred_set if any(by_key[k].language == "hi" for k in p)}
        return {
            "recall": round(len(pr & t) / len(t), 3) if t else None,
            "precision": round(len(pr & t) / len(pr), 3) if pr else None,
        }

    systems = {}
    for name, ps in (
        ("B0 exact ID + category ≤ 90 d", b0),
        ("B1 + fuzzy institution name", b1),
        ("Samanvay cascade", pred),
    ):
        systems[name] = {
            **_prf(ps, truth),
            "recall_by_kind": by_kind(ps),
            "false_positive_rate_hard_negatives": neg_fp(ps),
            "pairs_with_hindi": hindi(ps),
        }

    type_counts = defaultdict(int)
    for s in scored.values():
        type_counts[s.link_type or "none"] += 1

    keys = sorted(scored)
    s_arr = np.array([scored[k].score for k in keys])
    y_arr = np.array([1.0 if k in truth else 0.0 for k in keys])
    p_default = 1 / (1 + np.exp(-(s_arr - 4.0)))
    p_fit = 1 / (1 + np.exp(-(s_arr * params["a"] + params["b"])))

    # Institution resolution.
    sib_pids = {i.permanent_id for i in ds.institutions if i.trust_name}
    auto = correct = top3 = sib_n = sib_wrong = pending = 0
    for c in ds.complaints:
        res = resolutions[c.key]
        ids = [x.candidate.permanent_id for x in res.candidates]
        if c.institution_pid in ids[:3]:
            top3 += 1
        if res.status == "RESOLVED":
            auto += 1
            correct += res.institution.permanent_id == c.institution_pid
            if c.institution_pid in sib_pids:
                sib_n += 1
                sib_wrong += res.institution.permanent_id != c.institution_pid
        else:
            pending += 1
    n = len(ds.complaints)

    results = {
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "seed": seed,
        "text_backend": backend.name,
        "dataset": {
            "institutions": len(ds.institutions),
            "complaints": n,
            "true_overlap_pairs": len(truth),
            "hard_negative_pairs": len(ds.negatives),
            "hindi_complaints": sum(c.language == "hi" for c in ds.complaints),
            "candidate_pairs_scored": len(pairs),
            "naive_pairs": n * (n - 1) // 2,
        },
        "systems": systems,
        "samanvay_link_types": dict(type_counts),
        "calibration": {
            "uncalibrated": {"a": 1.0, "b": -4.0, "ece": ece(p_default, y_arr)},
            "platt": {**params, "ece": ece(p_fit, y_arr)},
            "note": f"Platt parameters fitted on independent synthetic seed {params['fitted_on_seed']} "
            f"and evaluated on seed {seed}. The demo seed activates them as matching model "
            "fs-v2-cal; on real data they must be re-fitted on officers' decisions.",
        },
        "institution_resolution": {
            "auto_resolved_share": round(auto / n, 3),
            "auto_resolve_precision": round(correct / auto, 4) if auto else None,
            "top3_recall": round(top3 / n, 3),
            "needs_officer_share": round(pending / n, 3),
            "sibling_campus_auto_resolved": sib_n,
            "sibling_campus_false_merges": sib_wrong,
            "targets": {"auto_resolve_precision": 0.98, "top3_recall": 0.97},
        },
        "targets": {"recall": 0.85, "precision": 0.80},
        "runtime_seconds": round(time.perf_counter() - started, 1),
        "caveats": [
            "Synthetic data proves the mechanism and the measurement method, not real-world accuracy.",
            "With the n-gram backend, Hindi–English pairs are matched on institution, category, shared "
            "amounts/dates/programmes and timing only; their text is not compared.",
            "Labels are generated with the data and stored outside the application database.",
        ],
    }
    if write:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / "results.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
        labels = {
            "seed": seed,
            "positives": [{"a": a, "b": b, "kind": k} for a, b, k in ds.positives],
            "hard_negatives": [{"a": a, "b": b, "kind": k} for a, b, k in ds.negatives],
        }
        (OUT_DIR / "labels.json").write_text(json.dumps(labels, indent=1))
    return results


def _fmt(results: dict) -> str:
    lines = [
        f"Benchmark seed {results['seed']} · backend {results['text_backend']} · "
        f"{results['dataset']['complaints']} complaints, {results['dataset']['true_overlap_pairs']} true pairs"
    ]
    for name, m in results["systems"].items():
        lines.append(
            f"  {name:32s} P={m['precision']:.3f} R={m['recall']:.3f} F1={m['f1']:.3f} "
            f"by kind={m['recall_by_kind']} FP(hard neg)={m['false_positive_rate_hard_negatives']}"
        )
    lines.append(f"  institution resolution: {results['institution_resolution']}")
    lines.append(f"  calibration: {results['calibration']['uncalibrated']} → {results['calibration']['platt']}")
    return "\n".join(lines)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", choices=["ngram", "embedding"], default="ngram")
    args = parser.parse_args()
    if args.backend == "embedding":
        from app.core.config import get_settings
        from app.modules.matching.similarity import EmbeddingBackend

        out = run(backend=EmbeddingBackend(get_settings().embedding_model), write=False)
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / "results_embedding.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))
    else:
        out = run()
    print(_fmt(out))
    print(f"  runtime {out['runtime_seconds']} s")
