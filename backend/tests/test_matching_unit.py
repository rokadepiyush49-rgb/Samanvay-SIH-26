"""Pure-function tests for normalisation, the resolver, pair scoring and the working-day calendar."""

import datetime as dt
import uuid

from hypothesis import given
from hypothesis import strategies as st

from app.modules.institution.resolver import InstCandidate, InstQuery, rank
from app.modules.matching import scoring
from app.modules.matching.normalize import (
    extract_entities,
    extract_refs,
    normalize_name,
    similarity_text,
    text_tokens,
    transliterate,
)
from app.modules.sla.calendar import WorkCalendar


def _cand(pid, name, city):
    return InstCandidate(
        id=uuid.uuid4(), permanent_id=pid, name=name, name_norm=normalize_name(name), city=city, district=city
    )


SIBLINGS = [
    _cand("1-1", "Sahyadri Valley Institute of Engineering", "Nashik"),
    _cand("1-2", "Sahyadri Valley Institute of Engineering", "Pune"),
]


def test_normalisation_and_transliteration():
    assert normalize_name("S.V. Inst. of Engg., Nashik") == "s v institute of engineering nashik"
    assert transliterate("नासिक") == "nasik"
    assert normalize_name("सह्याद्री वैली इंस्टीट्यूट ऑफ इंजीनियरिंग") == "sahyadri valley institute of engineering"


def test_reference_and_entity_extraction():
    refs = extract_refs("CPGRAMS AICTE/E/2026/0012345, PID 1-9990001234, W.P.(C) 1234/2026")
    assert refs["cpgrams"] == ["AICTE/E/2026/0012345"] and refs["permanent_ids"] == ["1-9990001234"]
    assert refs["court_cases"] == ["WP(C) 1234/2026"]
    hi = extract_entities("बी.टेक के लिए ₹40,000 शुल्क")
    en = extract_entities("B.Tech fee of Rs. 40,000")
    assert hi == en == {"amt:40000", "prog:btech"}


def test_sibling_campus_never_auto_resolved_without_location():
    res = rank(InstQuery(name="Sahyadri Valley Institute"), SIBLINGS)
    assert res.status != "RESOLVED"
    assert {c.candidate.city for c in res.candidates} == {"Nashik", "Pune"}


def test_city_in_text_resolves_and_penalises_sibling():
    res = rank(InstQuery(name="Sahyadri Valley Inst. of Engg., Nasik"), SIBLINGS)
    assert res.status == "RESOLVED" and res.institution.city == "Nashik"
    pune = next(c for c in res.candidates if c.candidate.city == "Pune")
    assert pune.probability < 0.6
    assert "other_city_in_text" in {r["code"] for r in pune.reasons}


def test_permanent_id_wins():
    res = rank(InstQuery(name="anything", permanent_id="1-2"), SIBLINGS)
    assert res.status == "RESOLVED" and res.institution.city == "Pune" and res.probability == 1.0


def _view(**kw):
    base = dict(
        id=uuid.uuid4(),
        case_no="X",
        institution_id=None,
        probable_institution_id=None,
        category_code="GRV_FEE",
        status="UNDER_EXAMINATION",
        holding_unit_id=uuid.uuid4(),
        received_on=dt.date(2026, 10, 1),
        complainant_hmac=None,
        hard_refs=set(),
        entities=set(),
        text="",
        language="en",
    )
    base.update(kw)
    return scoring.CaseView(**base)


def test_hard_reference_makes_a_duplicate():
    a, b = _view(hard_refs={"cpgrams:AICTE/E/2026/1"}), _view(hard_refs={"cpgrams:AICTE/E/2026/1"})
    ps = scoring.score_pair(a, b, {}, None, {"a": 1.4, "b": -11})
    assert ps.link_type == "D" and ps.probability > 0.5


def test_parallel_action_rule_needs_compatible_categories():
    inst = uuid.uuid4()
    rb = _view(institution_id=inst, category_code="NV_CERT_RETENTION", status="ACTION_INITIATED")
    pg = _view(institution_id=inst, category_code="GRV_CERTIFICATE")
    compat = {("NV_CERT_RETENTION", "GRV_CERTIFICATE"): 0.9, ("NV_CERT_RETENTION", "GRV_SCHOLARSHIP"): 0.1}
    assert scoring.score_pair(rb, pg, compat, None, {"a": 1.4, "b": -11}).link_type == "P"
    other = _view(institution_id=inst, category_code="GRV_SCHOLARSHIP")
    assert scoring.score_pair(rb, other, compat, None, {"a": 1.4, "b": -11}).link_type == "C"


def test_no_link_for_unrelated_cases():
    ps = scoring.score_pair(
        _view(category_code="GRV_FEE"), _view(category_code="NV_INFRA"), {}, None, {"a": 1.4, "b": -11}
    )
    assert ps.link_type is None


def _calendar():
    rows, idx, day = [], 0, dt.date(2026, 1, 1)
    holidays = {dt.date(2026, 1, 26), dt.date(2026, 8, 15), dt.date(2026, 10, 2), dt.date(2026, 12, 25)}
    while day <= dt.date(2027, 12, 31):
        working = day.weekday() < 5 and day not in holidays
        idx += working
        rows.append((day, working, idx))
        day += dt.timedelta(days=1)
    return WorkCalendar(rows)


CAL = _calendar()


@given(st.dates(min_value=dt.date(2026, 1, 1), max_value=dt.date(2027, 6, 30)), st.integers(min_value=1, max_value=120))
def test_working_day_arithmetic_round_trips(start, n):
    end = CAL.add_working_days(start, n)
    assert CAL.is_working(end)
    assert CAL.working_days_between(start, end) == n


def test_gandhi_jayanti_is_skipped():
    assert CAL.add_working_days(dt.date(2026, 10, 1), 1) == dt.date(2026, 10, 5)  # Fri 2 Oct holiday, then weekend


def test_hindi_words_survive_tokenisation_and_the_institution_name_is_removed():
    # Regression: \w does not match Devanagari vowel signs, which used to split "बकाया" into fragments.
    assert text_tokens("शुल्क बकाया बताकर मूल डिग्री रोक रहा है।") == ["शुल्क", "बकाया", "बताकर", "मूल", "डिग्री", "रोक"]
    text = similarity_text(
        "सह्याद्री वैली इंस्टीट्यूट ऑफ इंजीनियरिंग ने मेरी मूल डिग्री रोक ली।",
        ["Sahyadri Valley Institute of Engineering"],
        ["Nashik"],
    )
    assert "इंस्टीट्यूट" not in text and "इंजीनियरिंग" not in text
    assert "डिग्री" in text
