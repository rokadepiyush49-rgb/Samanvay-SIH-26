"""Institution identity resolution (blueprint SOL-02, §14.2 stage 1).

Exact Permanent ID wins outright. Otherwise trigram search proposes candidates and each is scored with
Fellegi–Sunter-style log-odds weights over field comparisons; every weight is returned as a reason code.
Auto-resolution needs a high probability, location (or ID) corroboration and a clear margin over the runner-up,
so sibling campuses of one trust are never merged silently.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field

from rapidfuzz import fuzz
from rapidfuzz.distance import JaroWinkler
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.modules.matching.normalize import acronym, normalize_name

PRIOR = -3.5
AUTO_THRESHOLD = 0.95
REVIEW_THRESHOLD = 0.60
MIN_MARGIN = 2.0  # log-odds gap to the runner-up required for auto-resolution
MODEL_VERSION = "fs-inst-v1"


@dataclass
class InstQuery:
    name: str = ""
    city: str | None = None
    district: str | None = None
    state: str | None = None
    pin: str | None = None
    address: str | None = None
    permanent_id: str | None = None


@dataclass
class InstCandidate:
    id: uuid.UUID
    permanent_id: str
    name: str
    name_norm: str
    city: str | None = None
    district: str | None = None
    state: str | None = None
    pin: str | None = None
    address: str | None = None
    region_id: int | None = None
    approval_status: str = "APPROVED"
    trust_name: str | None = None
    aliases_norm: list[str] = field(default_factory=list)


@dataclass
class ScoredCandidate:
    candidate: InstCandidate
    score: float
    probability: float
    reasons: list[dict]


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _norm_place(value: str | None) -> str:
    return normalize_name(value) if value else ""


def _mentions(tokens: list[str], place: str) -> bool:
    if not place:
        return False
    parts = place.split()
    if len(parts) > 1:
        return place in " ".join(tokens)
    return any(JaroWinkler.similarity(t, place) >= 0.9 for t in tokens if len(t) >= 3)


def score_candidate(q: InstQuery, cand: InstCandidate, other_cities: set[str]) -> ScoredCandidate:
    reasons: list[dict] = []
    score = PRIOR

    def add(code: str, label: str, weight: float) -> None:
        nonlocal score
        score += weight
        reasons.append({"code": code, "label": label, "weight": round(weight, 2)})

    qn = normalize_name(q.name)
    tokens = qn.split()
    city, district = _norm_place(cand.city), _norm_place(cand.district)
    loc_tokens = set(city.split()) | set(district.split())
    q_wo_loc = " ".join(t for t in tokens if t not in loc_tokens) or qn

    names = [cand.name_norm, *cand.aliases_norm]
    jw = max(max(JaroWinkler.similarity(qn, n), JaroWinkler.similarity(q_wo_loc, n)) for n in names)
    tsr = max(fuzz.token_set_ratio(q_wo_loc, n) for n in names)
    if jw >= 0.95:
        add("name_jw_high", f"Name match {jw:.2f}", 4.0)
    elif jw >= 0.88:
        add("name_jw_mid", f"Name close {jw:.2f}", 2.5)
    elif jw >= 0.80:
        add("name_jw_low", f"Name similar {jw:.2f}", 1.0)
    else:
        add("name_jw_none", f"Name differs {jw:.2f}", -2.0)
    if tsr >= 95:
        add("name_tokens", "All name words present", 1.5)
    elif tsr >= 85:
        add("name_tokens_most", "Most name words present", 0.5)
    if len(tokens) <= 2 and tokens and any(tokens[0] == acronym(n) for n in names if len(acronym(n)) >= 3):
        add("acronym", "Acronym matches", 2.0)

    corroborated = False
    q_pin = (q.pin or "").strip()
    if q_pin and cand.pin:
        if q_pin == cand.pin:
            add("pin_exact", "Same PIN code", 3.0)
            corroborated = True
        else:
            add("pin_differs", "Different PIN code", -2.0)

    explicit_city = _norm_place(q.city) or _norm_place(q.district)
    if explicit_city:
        if explicit_city in (city, district) or JaroWinkler.similarity(explicit_city, city or "-") >= 0.9:
            add("city_exact", f"Same city ({cand.city})", 2.0)
            corroborated = True
        else:
            add("city_differs", f"Different city (record: {cand.city})", -2.0)
    elif _mentions(tokens, city) or _mentions(tokens, district):
        add("city_in_text", f"Text names {cand.city}", 2.0)
        corroborated = True
    elif other_cities:
        add("other_city_in_text", "Text names a different campus city", -2.0)

    if q.state and cand.state:
        if _norm_place(q.state) == _norm_place(cand.state):
            add("state_same", "Same state", 0.5)
        else:
            add("state_differs", "Different state", -1.0)

    if q.address and cand.address:
        a, b = set(normalize_name(q.address).split()), set(normalize_name(cand.address).split())
        if a and b:
            jac = len(a & b) / len(a | b)
            if jac > 0:
                add("address_overlap", f"Address overlap {jac:.2f}", round(1.5 * jac, 2))

    result = ScoredCandidate(cand, score, _sigmoid(score), reasons)
    result.reasons.append(
        {
            "code": "corroborated",
            "label": "Location corroborated" if corroborated else "No location evidence",
            "weight": 0.0,
            "value": corroborated,
        }
    )
    return result


@dataclass
class Resolution:
    status: str  # RESOLVED | PENDING | UNRESOLVED
    institution: InstCandidate | None
    probability: float
    candidates: list[ScoredCandidate]
    method: str

    def candidates_payload(self) -> list[dict]:
        return [
            {
                "institution_id": str(c.candidate.id),
                "permanent_id": c.candidate.permanent_id,
                "name": c.candidate.name,
                "city": c.candidate.city,
                "state": c.candidate.state,
                "approval_status": c.candidate.approval_status,
                "probability": round(c.probability, 3),
                "reasons": c.reasons,
            }
            for c in self.candidates
        ]


def rank(q: InstQuery, candidates: list[InstCandidate]) -> Resolution:
    if q.permanent_id:
        exact = [c for c in candidates if c.permanent_id == q.permanent_id.strip()]
        if exact:
            sc = ScoredCandidate(
                exact[0], 10.0, 1.0, [{"code": "permanent_id", "label": "Permanent ID exact", "weight": 10.0}]
            )
            return Resolution("RESOLVED", exact[0], 1.0, [sc], "permanent_id")
    if not q.name.strip():
        return Resolution("UNRESOLVED", None, 0.0, [], "none")
    tokens = normalize_name(q.name).split()
    cities = {_norm_place(c.city) for c in candidates if c.city}
    scored = []
    for c in candidates:
        own = {_norm_place(c.city), _norm_place(c.district)}
        others = {x for x in cities - own if x and _mentions(tokens, x)}
        scored.append(score_candidate(q, c, others))
    scored.sort(key=lambda s: s.score, reverse=True)
    top = scored[:3]
    if not top:
        return Resolution("UNRESOLVED", None, 0.0, [], "fs")
    best = top[0]
    runner = top[1] if len(top) > 1 else None
    corroborated = any(r.get("code") == "corroborated" and r.get("value") for r in best.reasons)
    clear = runner is None or runner.probability < REVIEW_THRESHOLD or best.score - runner.score >= MIN_MARGIN
    if best.probability >= AUTO_THRESHOLD and corroborated and clear:
        return Resolution("RESOLVED", best.candidate, best.probability, top, "fs")
    if best.probability >= REVIEW_THRESHOLD:
        return Resolution("PENDING", None, best.probability, top, "fs")
    return Resolution("UNRESOLVED", None, best.probability, top, "fs")


_CANDIDATES_SQL = text(
    """
    WITH hits AS (
      SELECT i.id, similarity(i.name_norm, :q) AS sim FROM institution i
      WHERE i.name_norm % :q OR :q <% i.name_norm
      UNION ALL
      SELECT a.institution_id, similarity(a.alias_norm, :q) FROM institution_alias a
      WHERE a.alias_norm % :q OR :q <% a.alias_norm
    ), best AS (SELECT id, max(sim) AS sim FROM hits GROUP BY id ORDER BY max(sim) DESC LIMIT 25)
    SELECT i.id, i.permanent_id, i.name, i.name_norm, i.city, i.district, i.state, i.pin, i.address, i.region_id,
           i.approval_status, i.trust_name,
           coalesce(array_agg(a.alias_norm) FILTER (WHERE a.alias_norm IS NOT NULL), '{}') AS aliases
    FROM best b JOIN institution i ON i.id = b.id
    LEFT JOIN institution_alias a ON a.institution_id = i.id
    GROUP BY i.id, b.sim ORDER BY b.sim DESC
    """
)


def _row_to_candidate(r) -> InstCandidate:
    return InstCandidate(
        id=r.id,
        permanent_id=r.permanent_id,
        name=r.name,
        name_norm=r.name_norm,
        city=r.city,
        district=r.district,
        state=r.state,
        pin=r.pin,
        address=r.address,
        region_id=r.region_id,
        approval_status=r.approval_status,
        trust_name=r.trust_name,
        aliases_norm=list(r.aliases),
    )


def load_by_permanent_id(db: Session, pid: str) -> InstCandidate | None:
    r = db.execute(
        text(
            "SELECT i.id, i.permanent_id, i.name, i.name_norm, i.city, i.district, i.state, i.pin, i.address, "
            "i.region_id, i.approval_status, i.trust_name, '{}'::text[] AS aliases FROM institution i "
            "WHERE i.permanent_id = :p"
        ),
        {"p": pid.strip()},
    ).first()
    return _row_to_candidate(r) if r else None


def resolve(db: Session, q: InstQuery) -> Resolution:
    if q.permanent_id:
        hit = load_by_permanent_id(db, q.permanent_id)
        if hit:
            return rank(q, [hit])
    qn = normalize_name(q.name)
    if not qn:
        return Resolution("UNRESOLVED", None, 0.0, [], "none")
    rows = db.execute(_CANDIDATES_SQL, {"q": qn}).all()
    return rank(q, [_row_to_candidate(r) for r in rows])
