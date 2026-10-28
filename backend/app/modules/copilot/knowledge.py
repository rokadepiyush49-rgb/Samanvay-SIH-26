"""Operating rules the case assistant may cite (KB passages).

Each passage restates a rule this system enforces in code or reference data (SLA policies in migration 0002, the case
state machine, the Action Conflict Guard, custody handshake, assistance, tasks, access tiers, audit). They describe how
Samanvay is configured, not the text of any regulation; an officer checks the governing
regulation before relying on one.
"""

from __future__ import annotations

SOURCE = "Samanvay operating rules (as configured in this system)"

PASSAGES: list[tuple[str, str, str]] = [
    (
        "KB1",
        "Deadlines for CPGRAMS grievances",
        "A CPGRAMS grievance follows the DARPG rule of 21 calendar days (OM of 23 Aug 2024). Reminders go to the "
        "holding officer 3 days and 1 day before the deadline. If the matter will take longer, an interim reply is "
        "due by day 15; recording 'Interim reply sent' stops that reminder. The case escalates to the unit head 5 "
        "days after the deadline is missed.",
    ),
    (
        "KB2",
        "Deadlines for other grievances and norm-violation proceedings",
        "A grievance received outside CPGRAMS must be disposed of within 30 working days, with reminders 5 and 2 "
        "working days before; it escalates 5 working days after breach. A norm-violation proceeding has 90 working "
        "days, reminders 10 and 3 working days before, and escalates 10 working days after breach. When more than "
        "one policy applies, the strictest deadline wins. Working days exclude weekends and national holidays.",
    ),
    (
        "KB3",
        "Case statuses and how a case closes",
        "A case moves Received, Registered, Under examination, Awaiting information, Action initiated, Hearing, "
        "Decision recorded and Disposed, through recorded actions only. Nothing closes automatically: disposal "
        "needs an officer's decision with remarks. A disposed case can be reopened within 90 days. A case linked as"
        " a follower of a lead case is disposed together with the lead.",
    ),
    (
        "KB4",
        "Potential Overlapping Cases – Coordination Required",
        "When the overlap engine finds that another unit holds a related case on the same institution, it raises "
        "'Potential Overlapping Cases – Coordination Required' and opens a coordination card. The two units decide "
        "together whether the cases are duplicates, related or not related, and name a lead unit; a decision needs "
        "confirmation from the other unit. Similarity is evidence for review, not proof that the cases are the "
        "same.",
    ),
    (
        "KB5",
        "Needs verification",
        "If officers cannot yet decide whether two cases overlap, they can mark the coordination card 'Needs "
        "verification' and state what must be checked. The card stays undecided for up to 10 working days, the "
        "Action Conflict Guard keeps warning, and the card escalates if it is still undecided at the end.",
    ),
    (
        "KB6",
        "Action Conflict Guard",
        "Consequential actions (a letter seeking information, a show-cause notice, an expert-committee visit, a "
        "hearing notice) run the Action Conflict Guard first. If another unit holds an undecided overlapping case, "
        "the officer is asked to coordinate first. Proceeding anyway needs a reason of at least 10 characters, and "
        "the other units are notified. A guard check is valid once, for 15 minutes.",
    ),
    (
        "KB7",
        "Transfers: custody handshake",
        "A transfer is a proposal: the case stays with the sending unit until the receiving unit accepts it. The "
        "receiving unit can accept or return it with remarks; a return restores the case's previous status. Pending"
        " transfers send reminders and escalate if nobody acts.",
    ),
    (
        "KB8",
        "Requesting assistance without transferring",
        "The holding unit can ask another unit for assistance (an inspection, records, an opinion) while keeping "
        "the case. The assisting unit sees the complaint only while the request is open. A reminder goes after 2 "
        "working days without a response, and the request escalates after its due date. Sealed cases cannot be "
        "shared this way.",
    ),
    (
        "KB9",
        "Case tasks",
        "A task records what must happen next, which unit owns it and by when. A task can depend on another task of"
        " the same case and cannot be completed while that one is open. Tasks come from officers, from coordination"
        " decisions with a joint deadline, or from messages. The earliest-due open task is shown as the case's next"
        " action.",
    ),
    (
        "KB10",
        "Who can see a case",
        "Every officer can see that a case exists, who holds it and its status. The complaint text, documents and "
        "messages are visible to the holding unit, units coordinating on a related case, units with an open "
        "assistance request, a unit offered the case by transfer, and role-wide readers such as the Competent "
        "Authority. Sealed categories are hidden from everyone without clearance. The complainant's identity is "
        "encrypted and revealed only with a recorded reason.",
    ),
    (
        "KB11",
        "Documents",
        "Letters, replies and evidence up to 25 MB can be attached to a case. Each file is checked by type, scanned"
        " for malware and hashed with SHA-256 before anyone can download it.",
    ),
    (
        "KB12",
        "Audit trail",
        "Every action, view of full content, message and AI request is written to a hash-chained audit log. Signed "
        "checkpoints let an auditor verify that no entry was changed or removed.",
    ),
    (
        "KB13",
        "Case messages",
        "Each case has a message thread for the units that can see its content. Messages cannot be edited or "
        "deleted, notifications show only the case number and the author's unit, and the holding unit can turn an "
        "agreed step into a task.",
    ),
    (
        "KB14",
        "Routing recommendations",
        "The routing check suggests whether a case should stay, be transferred, or have assistance requested, from "
        "the units' mandates for the category, related cases they already hold and transfer history. It is "
        "advisory; the officer decides and the choice is recorded.",
    ),
]
