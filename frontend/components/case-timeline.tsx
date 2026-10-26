"use client";

import { ArrowLeftRight, CircleDot, FileText, Flag, MessageSquare, Network, ShieldAlert, TrendingUp, UserCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { fmtDate, fmtDateTime, label } from "@/lib/format";
import type { TimelineEvent } from "@/lib/types";
import { Badge, EmptyState, cx } from "./ui";

export const EVENT_LABEL: Record<string, string> = {
  RECEIVED: "Received", STATUS_CHANGED: "Status changed", ACTION: "Action", TRANSFER_PROPOSED: "Transfer proposed",
  TRANSFER_ACCEPTED: "Transfer accepted", TRANSFER_RETURNED: "Transfer returned", ASSIGNED: "Assigned",
  COORDINATION_OPENED: "Coordination opened", COORDINATION_DECIDED: "Coordination decided", ESCALATED: "Escalated",
  SLA_ASSIGNED: "Timeline set", INSTITUTION_RESOLVED: "Institution confirmed", NOTE: "Internal note",
  INTERIM_REPLY_SENT: "Interim reply sent", NEXT_ACTION: "Next action set", DOCUMENT_ADDED: "Document added",
  DOCUMENT_REJECTED: "Document rejected",
};

type Kind = "all" | "actions" | "custody" | "coordination" | "notes";
const KIND_OF = (t: string): Exclude<Kind, "all"> =>
  t.startsWith("TRANSFER") || t === "ASSIGNED" || t === "ESCALATED" ? "custody"
    : t.startsWith("COORDINATION") ? "coordination"
      : ["NOTE", "INTERIM_REPLY_SENT", "NEXT_ACTION", "DOCUMENT_ADDED", "DOCUMENT_REJECTED"].includes(t) ? "notes" : "actions";

function icon(t: string): { node: ReactNode; cls: string } {
  if (t.startsWith("TRANSFER")) return { node: <ArrowLeftRight size={14} aria-hidden />, cls: "bg-warn-soft text-warn" };
  if (t.startsWith("COORDINATION")) return { node: <Network size={14} aria-hidden />, cls: "bg-coord-soft text-coord" };
  if (t === "ESCALATED") return { node: <TrendingUp size={14} aria-hidden />, cls: "bg-danger-soft text-danger" };
  if (t === "ASSIGNED") return { node: <UserCheck size={14} aria-hidden />, cls: "bg-action-soft text-action" };
  if (t.startsWith("DOCUMENT")) return { node: <FileText size={14} aria-hidden />, cls: "bg-surface-2 text-muted" };
  if (["NOTE", "INTERIM_REPLY_SENT", "NEXT_ACTION"].includes(t)) return { node: <MessageSquare size={14} aria-hidden />, cls: "bg-surface-2 text-muted" };
  if (t === "ACTION") return { node: <Flag size={14} aria-hidden />, cls: "bg-navy text-white" };
  return { node: <CircleDot size={14} aria-hidden />, cls: "bg-action-soft text-action" };
}

export function EventLine({ e }: { e: TimelineEvent }) {
  const i = icon(e.type);
  return (
    <li className="group relative flex gap-3 pb-5 last:pb-0">
      <span className="absolute left-[13px] top-7 bottom-0 w-px bg-rule group-last:hidden" aria-hidden />
      <span className={cx("relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full ring-4 ring-surface", i.cls)}>{i.node}</span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-sm font-semibold">
            {e.type === "ACTION" ? e.action_label : EVENT_LABEL[e.type] ?? label(e.type)}
            {e.to_status && e.from_status !== e.to_status && <span className="font-normal text-muted"> → {label(e.to_status)}</span>}
            {e.to_unit && e.from_unit && <span className="font-normal text-muted"> · {e.from_unit} → {e.to_unit}</span>}
          </p>
          <p className="text-xs text-muted"><time dateTime={e.at}>{fmtDateTime(e.at)}</time> · {e.actor}{e.actor_unit ? ` (${e.actor_unit})` : ""}</p>
        </div>
        {e.remarks && <p className="mt-1 whitespace-pre-wrap text-sm text-ink/90">{e.remarks}</p>}
        {"guard_result" in e.data && (
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={e.data.guard_choice === "PROCEED_AND_NOTIFY" ? "warn" : "ok"} icon={<ShieldAlert size={12} aria-hidden />}>Guard: {label(String(e.data.guard_result))} · {label(String(e.data.guard_choice))}</Badge>
            {e.data.guard_reason ? <span className="text-muted">“{String(e.data.guard_reason)}”</span> : null}
          </p>
        )}
        {e.type === "COORDINATION_OPENED" && <p className="mt-1 text-xs font-medium text-coord">{String(e.data.phrase ?? "")} · {String(e.data.coordination ?? "")}</p>}
        {e.type === "COORDINATION_DECIDED" && <p className="mt-1 text-xs">{label(String(e.data.decision))}{e.data.lead_unit ? `, ${e.data.lead_unit} leads` : ""}{e.data.joint_due ? ` · joint action by ${fmtDate(String(e.data.joint_due))}` : ""}</p>}
        {e.type === "DOCUMENT_ADDED" && <p className="mt-1 font-mono text-[11px] text-muted">{String(e.data.filename)} · sha256 {String(e.data.sha256).slice(0, 16)}…</p>}
        {e.type === "SLA_ASSIGNED" && <p className="mt-1 text-xs text-muted">Policy {String(e.data.policy)} v{String(e.data.version)} · due {fmtDate(String(e.data.due))}</p>}
      </div>
    </li>
  );
}

/** Complete chronological history of a case, newest first, with a filter by kind of event. */
export function CaseTimeline({ events }: { events: TimelineEvent[] }) {
  const [kind, setKind] = useState<Kind>("all");
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  const shown = kind === "all" ? sorted : sorted.filter((e) => KIND_OF(e.type) === kind);
  const counts = sorted.reduce<Record<string, number>>((acc, e) => ((acc[KIND_OF(e.type)] = (acc[KIND_OF(e.type)] ?? 0) + 1), acc), {});
  const kinds: [Kind, string][] = [["all", "All"], ["actions", "Status & actions"], ["custody", "Custody & escalation"], ["coordination", "Coordination"], ["notes", "Notes & documents"]];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter timeline">
        {kinds.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
            className={cx("rounded-full border px-3 py-1 text-xs font-medium", kind === k ? "border-action bg-action-soft text-action-ink" : "border-rule text-muted hover:text-ink")}>
            {l} <span className="tabular opacity-70">{k === "all" ? sorted.length : counts[k] ?? 0}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? <EmptyState compact title="No events of this kind." /> : <ol className="flex flex-col">{shown.map((e) => <EventLine key={e.id} e={e} />)}</ol>}
    </div>
  );
}
