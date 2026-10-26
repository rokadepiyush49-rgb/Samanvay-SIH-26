"""Reference data: regions, categories, compatibility matrix, transition rules, SLA policies, calendar.

Every value here is a *proposal* (blueprint §4.3, Q2/Q3/Q5/Q6) and is data, so AICTE can change it without a
code release. SLA policies are inserted with approval_status = 'PROPOSED'.

Revision ID: 0002
"""

import datetime as dt

import sqlalchemy as sa
from alembic import op

from app.reference_data import CATEGORIES, compat_matrix

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

REGIONS = [
    (1, "CR", "Central (Bhopal)"),
    (2, "ER", "Eastern (Kolkata)"),
    (3, "NR", "Northern (Kanpur)"),
    (4, "NWR", "North-Western (Chandigarh)"),
    (5, "SR", "Southern (Chennai)"),
    (6, "SCR", "South-Central (Hyderabad)"),
    (7, "SWR", "South-Western (Bengaluru)"),
    (8, "WR", "Western (Mumbai)"),
    (9, "NER", "North-Eastern (Guwahati)"),
    (10, "GR", "Gurugram"),
    (11, "GJR", "Gujarat (Vadodara)"),
    (12, "KR", "Kerala (Thiruvananthapuram)"),
]

OPEN_WORK = ["CASE_OFFICER", "UNIT_HEAD", "REGIONAL_OFFICER", "COMPETENT_AUTHORITY"]
INTAKE = ["INTAKE_OFFICER", "CASE_OFFICER", "UNIT_HEAD", "REGIONAL_OFFICER"]
HEADS = ["UNIT_HEAD", "COMPETENT_AUTHORITY"]

# from_status, action, to_status, roles, requires_remarks, consequential, label, label_hi
TRANSITIONS = [
    ("RECEIVED", "REGISTER", "REGISTERED", INTAKE, False, False, "Register case", "पंजीकृत करें"),
    (
        "RECEIVED",
        "REJECT_AT_INTAKE",
        "REJECTED_AT_INTAKE",
        INTAKE,
        True,
        False,
        "Reject at intake (outside remit)",
        "अस्वीकार करें",
    ),
    ("REGISTERED", "START_EXAMINATION", "UNDER_EXAMINATION", OPEN_WORK, False, False, "Start examination", "जांच शुरू करें"),
    ("REOPENED", "START_EXAMINATION", "UNDER_EXAMINATION", OPEN_WORK, False, False, "Start examination", "जांच शुरू करें"),
    (
        "UNDER_EXAMINATION",
        "SEEK_INFORMATION",
        "AWAITING_INFORMATION",
        OPEN_WORK,
        True,
        True,
        "Seek information / letter to institution",
        "जानकारी मांगें",
    ),
    (
        "AWAITING_INFORMATION",
        "INFORMATION_RECEIVED",
        "UNDER_EXAMINATION",
        OPEN_WORK,
        False,
        False,
        "Information received",
        "जानकारी प्राप्त",
    ),
    (
        "UNDER_EXAMINATION",
        "SHOW_CAUSE_NOTICE",
        "ACTION_INITIATED",
        OPEN_WORK,
        True,
        True,
        "Issue show-cause notice",
        "कारण बताओ नोटिस",
    ),
    (
        "UNDER_EXAMINATION",
        "EXPERT_COMMITTEE_VISIT",
        "ACTION_INITIATED",
        OPEN_WORK,
        True,
        True,
        "Order expert-committee visit",
        "विशेषज्ञ समिति निरीक्षण",
    ),
    (
        "ACTION_INITIATED",
        "SHOW_CAUSE_NOTICE",
        "ACTION_INITIATED",
        OPEN_WORK,
        True,
        True,
        "Issue show-cause notice",
        "कारण बताओ नोटिस",
    ),
    (
        "ACTION_INITIATED",
        "EXPERT_COMMITTEE_VISIT",
        "ACTION_INITIATED",
        OPEN_WORK,
        True,
        True,
        "Order expert-committee visit",
        "विशेषज्ञ समिति निरीक्षण",
    ),
    ("ACTION_INITIATED", "SCHEDULE_HEARING", "HEARING", OPEN_WORK, True, True, "Issue hearing notice", "सुनवाई नोटिस"),
    (
        "UNDER_EXAMINATION",
        "RECORD_DECISION",
        "DECISION_RECORDED",
        HEADS,
        True,
        False,
        "Record decision",
        "निर्णय दर्ज करें",
    ),
    ("ACTION_INITIATED", "RECORD_DECISION", "DECISION_RECORDED", HEADS, True, False, "Record decision", "निर्णय दर्ज करें"),
    ("HEARING", "RECORD_DECISION", "DECISION_RECORDED", HEADS, True, False, "Record decision", "निर्णय दर्ज करें"),
    (
        "DECISION_RECORDED",
        "DISPOSE",
        "DISPOSED",
        ["CASE_OFFICER", "UNIT_HEAD", "COMPETENT_AUTHORITY"],
        True,
        True,
        "Dispose case",
        "मामला निपटाएं",
    ),
    ("DISPOSED", "REOPEN", "REOPENED", HEADS, True, False, "Reopen case", "पुनः खोलें"),
]

# code, name, channel, category_group, category, basis, target, reminders, interim day, escalate after
SLA_POLICIES = [
    (
        "CPGRAMS",
        "CPGRAMS grievance (DARPG OM 23 Aug 2024: 21 days, interim reply if longer)",
        "CPGRAMS",
        None,
        None,
        "CALENDAR",
        21,
        [3, 1],
        15,
        5,
    ),
    ("GRIEVANCE", "Grievance (non-CPGRAMS)", None, "GRIEVANCE", None, "WORKING", 30, [5, 2], None, 5),
    ("NORM_VIOLATION", "Norm-violation proceeding", None, "NORM_VIOLATION", None, "WORKING", 90, [10, 3], None, 10),
    ("MALPRACTICE", "Malpractice or vigilance matter", None, "MALPRACTICE", None, "WORKING", 90, [10, 3], None, 10),
    ("SAFETY", "Safety matter (ragging, harassment): urgent", None, "SAFETY", None, "WORKING", 7, [2, 1], None, 2),
    ("DEFAULT", "Default timeline", None, None, None, "WORKING", 30, [5, 2], None, 5),
]

# Fixed-date national holidays only. Replace with the official Government of India list each year.
FIXED_HOLIDAYS = [
    (1, 26, "Republic Day"),
    (8, 15, "Independence Day"),
    (10, 2, "Gandhi Jayanti"),
    (12, 25, "Christmas"),
]


def upgrade() -> None:
    bind = op.get_bind()
    for rid, code, name in REGIONS:
        bind.execute(
            sa.text("INSERT INTO region (id, code, name) VALUES (:i, :c, :n)"), {"i": rid, "c": code, "n": name}
        )

    for code, name, name_hi, group, unit, sens in CATEGORIES:
        bind.execute(
            sa.text(
                "INSERT INTO category (code, name, name_hi, group_code, default_unit_code, sensitivity) "
                "VALUES (:c, :n, :h, :g, :u, :s)"
            ),
            {"c": code, "n": name, "h": name_hi, "g": group, "u": unit, "s": sens},
        )

    for (a, b), score in compat_matrix().items():
        bind.execute(
            sa.text("INSERT INTO category_compat (a, b, score) VALUES (:a, :b, :s)"), {"a": a, "b": b, "s": score}
        )

    for frm, action, to, roles, remarks, conseq, label, label_hi in TRANSITIONS:
        bind.execute(
            sa.text(
                "INSERT INTO transition_rule (from_status, action, to_status, allowed_roles, requires_remarks, "
                "consequential, label, label_hi) VALUES (:f, :a, :t, :r, :rm, :c, :l, :lh)"
            ),
            {"f": frm, "a": action, "t": to, "r": roles, "rm": remarks, "c": conseq, "l": label, "lh": label_hi},
        )

    for code, name, channel, group, cat, basis, target, rem, interim, esc in SLA_POLICIES:
        bind.execute(
            sa.text(
                "INSERT INTO sla_policy (code, version, name, channel, category_group, category_code, day_basis, "
                "target_days, reminder_offsets, interim_reply_day, escalate_after_days) "
                "VALUES (:code, 1, :name, :ch, :g, :cat, :b, :t, :r, :i, :e)"
            ),
            {
                "code": code,
                "name": name,
                "ch": channel,
                "g": group,
                "cat": cat,
                "b": basis,
                "t": target,
                "r": rem,
                "i": interim,
                "e": esc,
            },
        )

    holidays = set()
    for year in range(2024, 2031):
        for month, day, name in FIXED_HOLIDAYS:
            d = dt.date(year, month, day)
            holidays.add(d)
            bind.execute(sa.text("INSERT INTO holiday (day, name) VALUES (:d, :n)"), {"d": d, "n": name})

    day, end, idx = dt.date(2024, 1, 1), dt.date(2030, 12, 31), 0
    rows = []
    while day <= end:
        working = day.weekday() < 5 and day not in holidays
        idx += 1 if working else 0
        rows.append({"d": day, "w": working, "i": idx})
        day += dt.timedelta(days=1)
    bind.execute(sa.text("INSERT INTO calendar_day (day, is_working, wd_index) VALUES (:d, :w, :i)"), rows)

    bind.execute(
        sa.text(
            "INSERT INTO matching_model (version, params, notes, is_active) VALUES (:v, CAST(:p AS jsonb), :n, true)"
        ),
        {
            "v": "fs-rules-v1",
            "p": '{"a": 1.0, "b": -4.0}',
            "n": "Initial log-odds weights from the blueprint (§14.2); calibration not yet fitted.",
        },
    )


def downgrade() -> None:
    for table in (
        "matching_model",
        "calendar_day",
        "holiday",
        "sla_policy",
        "transition_rule",
        "category_compat",
        "category",
        "region",
    ):
        op.execute(f"DELETE FROM {table}")
