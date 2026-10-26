"""Stages 3–4 of the matching cascade: pair features → log-odds → calibrated probability → overlap type.

Pure functions shared by the live engine and the benchmark, so benchmark numbers describe production code.
Weights are the blueprint's starting values (§14.2); a and b are Platt-scaling parameters.
"""

from __future__ import annotations

import datetime as dt
import math
import uuid
from dataclasses import dataclass, field

ACTION_STAGE = {"ACTION_INITIATED", "HEARING", "DECISION_RECORDED"}
TERMINAL = {"DISPOSED", "REJECTED_AT_INTAKE"}
PS_PHRASE = "Potential Overlapping Cases – Coordination Required"

TYPE_LABELS = {"D": "Duplicate", "P": "Parallel action", "R": "Related", "C": "Co-occurrence", "L": "Logged"}

# Deviations from the blueprint's starting weights (2.5c − 1.0 and 1.5·J), chosen on synthetic seed 2027 and never on
# the reported seed: agreement on the complaint category and on specific facts (amounts, dates, programmes) is rarer
# by chance than agreement on the institution, so in Fellegi–Sunter terms it deserves a larger m/u log-ratio.
CATEGORY_SCALE, CATEGORY_OFFSET = 3.5, -1.5
ENTITY_SCALE = 3.0


@dataclass
class CaseView:
    id: uuid.UUID
    case_no: str
    institution_id: uuid.UUID | None
    probable_institution_id: uuid.UUID | None
    category_code: str
    status: str
    holding_unit_id: uuid.UUID
    received_on: dt.date
    complainant_hmac: str | None
    hard_refs: set[str]
    entities: set[str]
    text: str
    language: str
    sensitivity: str = "NORMAL"
    sim_text: str | None = None  # text used for similarity (institution name and city removed)
    vector: list[float] | None = None
    extra: dict = field(default_factory=dict)

    @property
    def is_open(self) -> bool:
        return self.status not in TERMINAL


@dataclass
class PairScore:
    score: float
    probability: float
    link_type: str | None
    reasons: list[dict]
    hard_keys: list[str]


def _reason(code: str, label: str, weight: float, value: float | None = None) -> dict:
    out = {"code": code, "label": label, "weight": round(weight, 2)}
    if value is not None:
        out["value"] = round(value, 3)
    return out


def features(
    a: CaseView,
    b: CaseView,
    compat: dict[tuple[str, str], float],
    text_sim: float | None,
    bands: tuple[float, float, float],
    text_note: str | None = None,
) -> tuple[float, list[dict], list[str]]:
    reasons: list[dict] = []
    score = 0.0

    shared = sorted(a.hard_refs & b.hard_refs)
    if shared:
        score += 6.0
        reasons.append(_reason("hard_reference", f"Same reference {shared[0].split(':', 1)[1]}", 6.0))

    if a.complainant_hmac and b.complainant_hmac:
        if a.complainant_hmac == b.complainant_hmac:
            score += 3.0
            reasons.append(_reason("same_complainant", "Same complainant (hashed contact)", 3.0))
        else:
            score -= 0.5
            reasons.append(_reason("different_complainant", "Different complainants", -0.5))

    if a.institution_id and a.institution_id == b.institution_id:
        score += 4.0
        reasons.append(_reason("same_institution", "Same Permanent ID", 4.0))
    else:
        pa = a.institution_id or a.probable_institution_id
        pb = b.institution_id or b.probable_institution_id
        if pa and pa == pb:
            score += 2.0
            reasons.append(_reason("probable_institution", "Probably the same institution (unconfirmed)", 2.0))

    c = compat.get((a.category_code, b.category_code), 1.0 if a.category_code == b.category_code else 0.1)
    w = CATEGORY_SCALE * c + CATEGORY_OFFSET
    score += w
    reasons.append(_reason("category", f"Category compatibility {c:.1f}", w, c))

    if text_sim is None:
        reasons.append(_reason("text_not_compared", text_note or "Text not compared", 0.0))
    else:
        high, mid, low = bands
        if text_sim >= high:
            w = 2.5
        elif text_sim >= mid:
            w = 1.5
        elif text_sim >= low:
            w = 0.3
        else:
            w = -1.0
        score += w
        reasons.append(_reason("text_similarity", f"Text similarity {text_sim:.2f}", w, text_sim))

    if a.entities and b.entities:
        jac = len(a.entities & b.entities) / len(a.entities | b.entities)
        if jac > 0:
            w = ENTITY_SCALE * jac
            score += w
            reasons.append(_reason("entities", f"Shared amounts/dates/programmes {jac:.2f}", w, jac))

    gap = abs((a.received_on - b.received_on).days)
    if gap <= 30:
        score += 0.6
        reasons.append(_reason("time_gap", f"{gap} days apart", 0.6))
    elif gap <= 180:
        reasons.append(_reason("time_gap", f"{gap} days apart", 0.0))
    else:
        score -= 0.8
        reasons.append(_reason("time_gap", f"{gap} days apart", -0.8))
    return score, reasons, shared


def probability(score: float, a: float = 1.0, b: float = -4.0) -> float:
    return 1.0 / (1.0 + math.exp(-(a * score + b)))


PARALLEL_RULE_COMPAT = 0.5


def classify(p: float, x: CaseView, y: CaseView, reasons: list[dict]) -> str | None:
    codes = {r["code"] for r in reasons}
    strong_identity = "same_complainant" in codes or "hard_reference" in codes
    different_units = x.holding_unit_id != y.holding_unit_id
    both_open = x.is_open and y.is_open
    acting = x.status in ACTION_STAGE or y.status in ACTION_STAGE
    compat = next((r.get("value", 0.0) for r in reasons if r["code"] == "category"), 0.0)
    if p >= 0.50 and strong_identity:
        return "D"
    # The PS's own example: a unit has initiated action while another unit holds an open, compatible matter on the
    # same (confirmed) institution. That alone warrants "Coordination Required", whatever the text says.
    parallel_rule = "same_institution" in codes and compat >= PARALLEL_RULE_COMPAT
    if different_units and both_open and acting and (p >= 0.70 or parallel_rule):
        if p < 0.70:
            reasons.append(
                _reason(
                    "parallel_rule",
                    "Rule: one unit has initiated action on the same institution while another holds a compatible "
                    "open matter",
                    0.0,
                )
            )
        return "P"
    if p >= 0.50:
        return "R"
    same_institution = "same_institution" in codes
    if same_institution and both_open and different_units:
        return "C"
    if p >= 0.30:
        return "L"
    return None


def score_pair(a: CaseView, b: CaseView, compat: dict[tuple[str, str], float], backend, params: dict) -> PairScore:
    note = None
    sim = None
    if backend is not None:
        sim = backend.similarity(a.sim_text or a.text, b.sim_text or b.text, a.language, b.language, a.vector, b.vector)
        if sim is None:
            note = "Text not compared (different languages)" if a.language != b.language else "Text not compared"
    else:
        note = "Text not compared (similarity service unavailable)"
    s, reasons, shared = features(a, b, compat, sim, getattr(backend, "bands", (0.85, 0.75, 0.6)), note)
    p = probability(s, params.get("a", 1.0), params.get("b", -4.0))
    return PairScore(s, p, classify(p, a, b, reasons), reasons, shared)


def needs_alert(link_type: str, a: CaseView, b: CaseView) -> bool:
    """Immediate cross-unit alert + coordination card: parallel action, or a duplicate held by two units."""
    return link_type == "P" or (link_type == "D" and a.holding_unit_id != b.holding_unit_id)


def hard_refs_of(refs: dict, cpgrams_no: str | None, court_case_no: str | None, unit_file_no: str | None) -> set[str]:
    out = {f"cpgrams:{x}" for x in refs.get("cpgrams", [])}
    out |= {f"court:{x}" for x in refs.get("court_cases", [])}
    out |= {f"file:{x}" for x in refs.get("file_nos", [])}
    if cpgrams_no:
        out.add(f"cpgrams:{cpgrams_no}")
    if court_case_no:
        out.add(f"court:{court_case_no}")
    if unit_file_no:
        out.add(f"file:{unit_file_no.upper()}")
    return out
