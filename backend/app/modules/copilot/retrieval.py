"""Retrieval for the case assistant: the case file and the operating rules cut into cited passages, ranked by BM25.

Passages are built from the same projection the case page shows (views.case_detail), so the assistant never sees more
than the officer asking: a metadata-tier reader gets no complaint text, documents or messages to retrieve from.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field

from app.modules.copilot import knowledge

_TOKEN = re.compile(r"[a-z0-9ऀ-ॿ]+")
_STOP = frozenset(
    [
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "can",
        "could",
        "did",
        "do",
        "does",
        "for",
        "from",
        "has",
        "have",
        "how",
        "i",
        "if",
        "in",
        "is",
        "it",
        "its",
        "me",
        "my",
        "of",
        "on",
        "or",
        "our",
        "should",
        "so",
        "that",
        "the",
        "their",
        "them",
        "then",
        "there",
        "this",
        "to",
        "us",
        "was",
        "we",
        "were",
        "what",
        "when",
        "where",
        "which",
        "who",
        "whom",
        "why",
        "will",
        "with",
        "would",
        "you",
        "your",
        "case",
        "cases",
    ]
)
# Officers ask in their own words; expand a few to the words the case file uses.
_EXPAND = {
    "due": ["deadline", "expected", "disposal", "overdue"],
    "deadline": ["expected", "disposal", "due", "overdue"],
    "late": ["overdue", "deadline"],
    "holds": ["custodian", "holding", "held"],
    "owner": ["custodian", "holding", "held"],
    "custody": ["custodian", "holding", "held", "transfer"],
    "next": ["task", "action", "pending"],
    "pending": ["task", "open"],
    "duplicate": ["overlap", "linked", "coordination"],
    "related": ["overlap", "linked", "coordination"],
    "other": ["overlap", "linked", "coordination"],
    "evidence": ["document", "documents"],
    "files": ["document", "documents"],
    "interim": ["interim", "reply"],
    "close": ["disposed", "disposal", "decision"],
    "help": ["assistance"],
    "see": ["visible", "access"],
    "share": ["assistance", "visible", "access"],
}


def _stem(w: str) -> str:
    if len(w) > 5 and w.endswith("ing"):
        return w[:-3]
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith("ed"):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def tokens(text: str, expand: bool = False) -> list[str]:
    words = [w for w in _TOKEN.findall((text or "").lower()) if w not in _STOP]
    if expand:
        words = words + [x for w in words for x in _EXPAND.get(w, [])]
    return [_stem(w) for w in words]


@dataclass
class Passage:
    id: str
    title: str
    text: str
    kind: str  # FACTS | COMPLAINT | EVENT | TASK | LINK | ASSIST | DOCUMENT | MESSAGE | ROUTING | ISSUE | RULE
    ref: dict = field(default_factory=dict)

    def public(self) -> dict:
        return {"id": self.id, "title": self.title, "text": self.text, "kind": self.kind, "ref": self.ref}


def day(iso: str | None) -> str:
    if not iso:
        return "not set"
    y, m, d = iso[:10].split("-")
    return f"{d}-{m}-{y}"


def _chunks(text: str, size: int = 600) -> list[str]:
    sentences = re.split(r"(?<=[.!?।])\s+", (text or "").strip())
    out, cur = [], ""
    for s in sentences:
        if cur and len(cur) + len(s) > size:
            out.append(cur)
            cur = s
        else:
            cur = f"{cur} {s}".strip()
    if cur:
        out.append(cur)
    return out


def event_label(e: dict) -> str:
    """Action label for an event; codes without a label (IMPORTED, SLA_ASSIGNED) become words."""
    label = e.get("action_label") or e["type"]
    return label.replace("_", " ").capitalize() if label.isupper() else label


def deadline_sentence(c: dict) -> str:
    if c.get("bucket") in ("disposed", "rejected"):
        return f"The case is closed ({c['status_label']})."
    if not c.get("expected_disposal"):
        return "No disposal deadline is set yet."
    if c.get("overdue"):
        return f"Expected disposal was {day(c['expected_disposal'])}; the case is overdue."
    left = c.get("working_days_left")
    return f"Expected disposal is {day(c['expected_disposal'])}" + (
        f", {left} working days left." if left is not None else "."
    )


def case_passages(c: dict, messages: list[dict] | None = None) -> list[Passage]:
    """Cut the case projection into passages with short citable IDs (C = case, E = event, T = task, ...)."""
    out: list[Passage] = []
    inst = c.get("institution")
    inst_txt = (
        f"{inst['name']}{', ' + inst['city'] if inst.get('city') else ''} (permanent ID {inst['permanent_id']})"
        if inst
        else f"an institution not yet confirmed ({c.get('institution_raw') or 'name not given'})"
    )
    officer = c["holding_officer"]["name"] if c.get("holding_officer") else "no officer assigned"
    policy = c.get("sla_policy")
    facts = (
        f"Case {c['case_no']} is a {c['category']['name']} matter about {inst_txt}, received by "
        f"{c['channel'].replace('_', ' ').lower()} on {day(c['received_on'])}. Status: {c['status_label']}. "
        f"Current custodian: {c['holding_unit']['code']} ({c['holding_unit']['name']}), {officer}, since "
        f"{day(c.get('holder_since'))}. {deadline_sentence(c)}"
    )
    if policy:
        facts += (
            f" Deadline policy: {policy['name']}, {policy['target_days']} "
            f"{'working' if policy['day_basis'] == 'WORKING' else 'calendar'} days."
        )
    if c.get("cpgrams_no"):
        facts += f" CPGRAMS number {c['cpgrams_no']}."
    if c.get("escalated"):
        facts += " The case has been escalated."
    out.append(Passage("C1", "Case facts", facts, "FACTS"))

    content = c.get("content")
    if content:
        subject = content["subject"].rstrip(" .")
        for i, chunk in enumerate(_chunks(f"Subject: {subject}. {content['body']}"), start=2):
            out.append(Passage(f"C{i}", "Complaint as received", chunk, "COMPLAINT"))

    for e in sorted(c.get("timeline", []), key=lambda x: x["at"]):
        bits = [f"{day(e['at'])}: {event_label(e)}"]
        if e.get("actor"):
            bits.append(f"by {e['actor']}" + (f" ({e['actor_unit']})" if e.get("actor_unit") else ""))
        if e.get("from_status") and e.get("to_status") and e["from_status"] != e["to_status"]:
            bits.append(
                f"status {e['from_status'].replace('_', ' ').lower()} to {e['to_status'].replace('_', ' ').lower()}"
            )
        if e.get("from_unit") and e.get("to_unit") and e["from_unit"] != e["to_unit"]:
            bits.append(f"from {e['from_unit']} to {e['to_unit']}")
        txt = ", ".join(bits) + "."
        if e.get("remarks"):
            txt += f" Remarks: {e['remarks']}"
        out.append(Passage(f"E{e['id']}", "Case history", txt, "EVENT", {"event_id": e["id"]}))

    for i, t in enumerate(c.get("tasks", []), start=1):
        state = "blocked" if t.get("blocked") else t["status"].lower()
        txt = f"Task '{t['title']}' owned by {t['owner_unit']}" + (f" ({t['owner']})" if t.get("owner") else "")
        txt += f", {state}" + (f", due {day(t['due_on'])}" if t.get("due_on") else ", no due date")
        txt += " (overdue)." if t.get("overdue") else "."
        if t.get("depends_on"):
            txt += f" Depends on '{t['depends_on']['title']}'."
        if t.get("done_note"):
            txt += f" Note: {t['done_note']}"
        out.append(Passage(f"T{i}", "Task", txt, "TASK", {"task_id": t["id"]}))

    for i, lk in enumerate(c.get("links", []), start=1):
        # Rule-triggered links (parallel action, co-occurrence) carry no meaningful model score.
        strength = f"match strength {lk['probability']:.2f}, " if lk["probability"] >= 0.05 else ""
        txt = (
            f"Linked case {lk['other_case']} held by {lk['other_unit']} "
            f"({lk.get('other_status_label') or 'status hidden'}): overlap type {lk['type_label']}, "
            f"{strength}link {lk['status'].lower()}."
        )
        if lk.get("coordination_code"):
            txt += f" Coordination {lk['coordination_code']} is {lk['coordination_status'].replace('_', ' ').lower()}"
            txt += f", decision {lk['decision'].replace('_', ' ').lower()}" if lk.get("decision") else ""
            txt += f", lead unit {lk['lead_unit']}." if lk.get("lead_unit") else "."
        reasons = [
            r["label"]
            for r in sorted(lk.get("reasons") or [], key=lambda r: -abs(r.get("weight") or 0))
            if isinstance(r, dict) and r.get("label") and (r.get("weight") or 0) > 0
        ]
        if reasons:
            txt += " Why matched: " + "; ".join(reasons[:3]) + "."
        out.append(Passage(f"L{i}", "Related case", txt, "LINK", {"case_no": lk["other_case"]}))

    for i, a in enumerate(c.get("assistance", []), start=1):
        txt = (
            f"Assistance request {a['code']} from {a['from_unit']} to {a['to_unit']} ({a['kind_label']}): "
            f"{a['request']} Status {a['status'].lower()}, due {day(a['due_on'])}"
            + (" (overdue)." if a.get("overdue") else ".")
        )
        if a.get("response"):
            txt += f" Response: {a['response']}"
        out.append(Passage(f"A{i}", "Assistance", txt, "ASSIST", {"code": a["code"]}))

    for i, doc in enumerate(c.get("documents") or [], start=1):
        txt = (
            f"Document {doc['filename']} uploaded by {doc.get('uploaded_by') or 'unknown'} on "
            f"{day(doc['uploaded_at'])}, scan {doc['scan_status'].lower()}."
        )
        out.append(Passage(f"D{i}", "Document", txt, "DOCUMENT", {"document_id": doc["id"]}))

    for i, m in enumerate(messages or [], start=1):
        txt = f"{day(m['at'])}, {m['author']} ({m['unit']}) wrote: {m['body']}"
        out.append(Passage(f"M{i}", "Case message", txt, "MESSAGE", {"message_id": m["id"]}))

    r = c.get("routing")
    if r and r.get("action"):
        txt = f"Routing check recommends: {r['action'].lower()}" + (f" to {r['unit']}" if r.get("unit") else "") + "."
        if r.get("note"):
            txt += f" {r['note']}"
        out.append(Passage("R1", "Routing check", txt, "ROUTING"))

    issue = c.get("issue")
    if issue:
        others = ", ".join(issue.get("case_nos", [])[:6])
        txt = (
            f"This case is part of a recurring pattern at the institution: {issue.get('label')}, "
            f"{issue.get('incidents')} separate incidents in the last year ({others})."
        )
        out.append(Passage("I1", "Recurring issue", txt, "ISSUE"))
    return out


def rule_passages() -> list[Passage]:
    return [Passage(pid, title, txt, "RULE", {"source": knowledge.SOURCE}) for pid, title, txt in knowledge.PASSAGES]


class BM25:
    def __init__(self, passages: list[Passage], k1: float = 1.4, b: float = 0.75) -> None:
        self.passages = passages
        self.docs = [tokens(f"{p.title} {p.text}") for p in passages]
        self.k1, self.b = k1, b
        self.avg = sum(len(d) for d in self.docs) / max(1, len(self.docs))
        df: Counter[str] = Counter()
        for d in self.docs:
            df.update(set(d))
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self.tf = [Counter(d) for d in self.docs]

    def search(self, query: str, k: int = 6) -> list[tuple[Passage, float]]:
        q = tokens(query, expand=True)
        scored = []
        for i, tf in enumerate(self.tf):
            length = len(self.docs[i]) or 1
            s = 0.0
            for t in set(q):
                f = tf.get(t)
                if f:
                    s += self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * length / self.avg))
            if s > 0:
                scored.append((self.passages[i], s))
        scored.sort(key=lambda x: -x[1])
        return scored[:k]
