"use client";

import { Check, ChevronRight, Clock, Flag, TrendingUp } from "lucide-react";
import Link from "next/link";
import { fmtDate, label } from "@/lib/format";
import type { CoordinationCard } from "@/lib/types";
import { CoordinationStatusBadge, EvidenceList, OverlapTypeBadge } from "./status";
import { Badge, cx } from "./ui";

/** What could go wrong if the two units act separately, by overlap type. */
export const RISK: Record<string, string> = {
  P: "Both units are taking regulatory action on this institution in parallel. Without a lead unit, notices or visits can conflict.",
  D: "The same complaint is registered twice. Separate replies would duplicate work and may contradict each other.",
  R: "Related matters on the same institution. Actions should be sequenced by one lead unit.",
  C: "Cases occurred close together on the same institution. Review whether they share facts.",
  L: "Logged for reference only.",
};

/** Plain-language outstanding step for the card, from the API's status and proposal. */
export function outstanding(c: CoordinationCard): string {
  if (c.status === "DECIDED") return `Decided: ${label(c.decision)}${c.lead_unit ? `, ${c.lead_unit} leads` : ""}`;
  const p = c.proposal;
  if (c.status === "AWAITING_CONFIRMATION" && p) {
    const other = [c.a.unit, c.b.unit].find((u) => u !== p.by_unit) ?? "the other unit";
    return c.awaiting_me ? `${p.by_unit} proposed ${label(p.decision)} — your confirmation is needed` : `Awaiting ${other} to confirm ${p.by_unit}'s proposal`;
  }
  if (c.status === "ESCALATED") return "Escalated — the nodal officer or Competent Authority decides";
  return "Needs a proposal from either unit";
}

export function CoordinationRow({ c }: { c: CoordinationCard }) {
  const open = c.status !== "DECIDED";
  return (
    <li>
      <Link href={`/coordination/${c.code}`} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-surface-2/60 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_200px_20px] lg:items-center" data-testid="coordination-row">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <OverlapTypeBadge type={c.type} prob={c.probability} />
            <span className="font-mono text-xs text-muted">{c.code}</span>
            {c.awaiting_me && <Badge tone="danger" icon={<Flag size={12} aria-hidden />}>Your decision</Badge>}
          </div>
          <p className="mt-1.5 truncate font-semibold">{c.institution.name ?? "Institution unconfirmed"}</p>
          <p className="truncate text-xs text-muted">{c.institution.city ?? ""}{c.institution.permanent_id ? ` · ${c.institution.permanent_id}` : ""}</p>
        </div>
        <div className="min-w-0 text-sm">
          <p className="flex flex-wrap items-center gap-x-1.5"><b>{c.a.unit}</b><span className="font-mono text-xs">{c.a.case_no}</span><span className="text-muted" aria-label="and">↔</span><b>{c.b.unit}</b><span className="font-mono text-xs">{c.b.case_no}</span></p>
          <div className="mt-1.5"><EvidenceList reasons={c.reasons} compact /></div>
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <CoordinationStatusBadge status={c.status} />
          <span className="text-muted">{outstanding(c)}</span>
          {open && <span className={cx("flex items-center gap-1", c.working_days_left <= 1 ? "font-semibold text-danger" : "text-muted")}><Clock size={12} aria-hidden />Decide by {fmtDate(c.decide_by)} · {c.working_days_left} wd</span>}
        </div>
        <ChevronRight size={18} className="hidden text-muted group-hover:text-ink lg:block" aria-hidden />
      </Link>
    </li>
  );
}

/** Two-party agreement: flagged → proposed by one unit → confirmed by the other (or escalated and decided). */
export function ApprovalSteps({ c }: { c: CoordinationCard }) {
  const p = c.proposal;
  const decided = c.status === "DECIDED";
  const proposed = !!p || decided;
  const steps = [
    { label: "Flagged by the overlap engine", detail: "Both units notified", state: "done" as const },
    { label: p ? `Proposed by ${p.by_unit}` : "Proposal", detail: p ? `${label(p.decision)}${p.lead_unit ? `, ${p.lead_unit} leads` : ""}${p.by ? ` · ${p.by}` : ""}` : "Either unit proposes", state: proposed ? ("done" as const) : ("current" as const) },
    {
      label: c.status === "ESCALATED" ? "Escalated decision" : "Confirmation by the other unit",
      detail: decided ? `${label(c.decision)}${c.lead_unit ? `, ${c.lead_unit} leads` : ""}` : c.status === "ESCALATED" ? "Nodal officer / Competent Authority" : proposed ? "Waiting" : "After a proposal",
      state: decided ? ("done" as const) : proposed || c.status === "ESCALATED" ? ("current" as const) : ("todo" as const),
    },
  ];
  return (
    <ol className="grid gap-3 sm:grid-cols-3" aria-label="Decision progress">
      {steps.map((s, i) => (
        <li key={i} className={cx("flex gap-3 rounded-lg border p-3", s.state === "current" ? "border-action/40 bg-action-soft/50" : "border-rule")} aria-current={s.state === "current" ? "step" : undefined}>
          <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold",
            s.state === "done" ? "bg-ok text-white" : s.state === "current" ? (c.status === "ESCALATED" && i === 2 ? "bg-danger text-white" : "bg-action text-white") : "bg-surface-2 text-muted")} aria-hidden>
            {s.state === "done" ? <Check size={14} /> : c.status === "ESCALATED" && i === 2 ? <TrendingUp size={13} /> : i + 1}
          </span>
          <span className="min-w-0 text-sm">
            <span className="block font-semibold">{s.label}</span>
            <span className="block text-xs text-muted">{s.detail}</span>
            <span className="sr-only">{s.state === "done" ? "completed" : s.state === "current" ? "in progress" : "not started"}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
