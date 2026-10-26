"""Read-only feeds added for the web app: the transfers list and the cockpit analytics breakdowns."""

from tests.conftest import new_case


def test_transfers_list_by_direction_and_reason_visibility(as_user):
    pgrc, rb, senior = as_user("pgrc_officer"), as_user("rb_officer"), as_user("senior")
    case = new_case(pgrc)
    tid = pgrc.post(
        f"/cases/{case['case_no']}/transfers", json={"to_unit": "RB", "reason": "RB has jurisdiction"}
    ).json()["transfer_id"]

    incoming = rb.get("/transfers", params={"direction": "incoming"}).json()["items"]
    row = next(t for t in incoming if t["id"] == tid)
    assert row["from_unit"] == "PGRC" and row["to_unit"] == "RB" and row["holding_unit"] == "PGRC"
    assert row["can_decide"] is True and row["reason"] == "RB has jurisdiction"

    outgoing = pgrc.get("/transfers", params={"direction": "outgoing"}).json()["items"]
    assert next(t for t in outgoing if t["id"] == tid)["can_decide"] is False
    assert all(t["id"] != tid for t in pgrc.get("/transfers", params={"direction": "incoming"}).json()["items"])

    # Oversight sees the handshake but not the reason text.
    seen = next(t for t in senior.get("/transfers").json()["items"] if t["id"] == tid)
    assert seen["reason"] is None

    rb.post(f"/transfers/{tid}/accept", json={"remarks": "Accepted"})
    assert all(t["id"] != tid for t in rb.get("/transfers", params={"direction": "incoming"}).json()["items"])
    closed = rb.get("/transfers", params={"state": "closed"}).json()["items"]
    done = next(t for t in closed if t["id"] == tid)
    assert done["status"] == "ACCEPTED" and done["decided_by"] == "Rb Officer" and done["holding_unit"] == "RB"


def test_analytics_totals_match_summary_and_scope(as_user):
    senior = as_user("senior")
    new_case(as_user("pgrc_officer"))
    summary = senior.get("/dashboard/summary").json()
    data = senior.get("/dashboard/analytics", params={"months": 6}).json()
    assert len(data["trend"]) >= 6
    total = next(t["value"] for t in summary["tiles"] if t["key"] == "total")
    assert sum(u["total"] for u in data["by_unit"]) == total
    pgrc = next(u for u in data["by_unit"] if u["key"] == "PGRC")
    listed = senior.get("/cases", params={"unit": "PGRC", "status": "pending", "limit": 1}).json()
    assert listed["total"] == pgrc["pending"]

    scoped = as_user("rb_head").get("/dashboard/analytics", params={"unit": "PGRC"}).json()
    assert scoped["scope"]["unit"] == "RB" and {u["key"] for u in scoped["by_unit"]} <= {"RB"}
    assert as_user("rb_officer").get("/dashboard/analytics").status_code == 403
