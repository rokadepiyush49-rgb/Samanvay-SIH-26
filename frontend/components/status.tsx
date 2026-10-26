"use client";

import {
  ArrowDown, ArrowLeftRight, ArrowUp, Ban, CheckCircle2, CircleDashed, Clock, Flag, GitMerge, HelpCircle, Link2, Lock, Minus,
  OctagonAlert, TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import { fmtDate } from "@/lib/format";
import { PRIORITY_LABEL, priorityOf, type Priority } from "@/lib/priority";
import type { CaseRow, Reason } from "@/lib/types";
import { Badge, cx, type Tone } from "./ui";

/** Case status: icon + text, never colour alone. Bucket = the PS reporting category. */
const STATUS: Record<string, { tone: Tone; icon: ReactNode }> = {
  pending: { tone: "warn", icon: <Clock size={12} aria-hidden /> },
  under_process: { tone: "info", icon: <CircleDashed size={12} aria-hidden /> },
  disposed: { tone: "ok", icon: <CheckCircle2 size={12} aria-hidden /> },
  rejected: { tone: "neutral", icon: <Ban size={12} aria-hidden /> },
  transferred: { tone: "coord", icon: <ArrowLeftRight size={12} aria-hidden /> },
};

export function StatusBadge({ bucket, label }: { bucket: string; label: string }) {
  const s = STATUS[bucket] ?? STATUS.pending;
  return <Badge tone={s.tone} icon={s.icon}>{label}</Badge>;
}

const PRIORITY: Record<Priority, { cls: string; icon: ReactNode }> = {
  critical: { cls: "text-danger", icon: <OctagonAlert size={14} aria-hidden /> },
  high: { cls: "text-warn", icon: <ArrowUp size={14} aria-hidden /> },
  medium: { cls: "text-action", icon: <Minus size={14} aria-hidden /> },
  low: { cls: "text-muted", icon: <ArrowDown size={14} aria-hidden /> },
};

export function PriorityIndicator({ c, priority }: { c?: CaseRow; priority?: Priority }) {
  const p = priority ?? (c ? priorityOf(c) : "low");
  return (
    <span className={cx("inline-flex items-center gap-1 text-xs font-semibold", PRIORITY[p].cls)} data-priority={p}>
      {PRIORITY[p].icon}
      {PRIORITY_LABEL[p]}
    </span>
  );
}

/** Overlap type from the matching engine. Rule-triggered parallel-action links carry no meaningful probability. */
const TYPE: Record<string, { name: string; tone: Tone }> = {
  P: { name: "Parallel action", tone: "danger" },
  D: { name: "Duplicate", tone: "warn" },
  R: { name: "Related", tone: "coord" },
  C: { name: "Co-occurrence", tone: "info" },
  L: { name: "Logged", tone: "neutral" },
};

export function OverlapTypeBadge({ type, prob }: { type: string; prob?: number }) {
  const t = TYPE[type] ?? { name: type, tone: "neutral" as Tone };
  return (
    <Badge tone={t.tone} icon={<GitMerge size={12} aria-hidden />} title={prob !== undefined && prob >= 0.01 ? `Model score ${prob.toFixed(2)} (same-matter probability)` : undefined}>
      {t.name}
      {prob !== undefined && prob >= 0.01 && <span className="tabular opacity-80">· {prob.toFixed(2)}</span>}
    </Badge>
  );
}

export const OVERLAP_TYPE_NAME = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [k, v.name]));

const COORD_STATUS: Record<string, { tone: Tone; text: string }> = {
  OPEN: { tone: "warn", text: "Needs a proposal" },
  AWAITING_CONFIRMATION: { tone: "info", text: "Awaiting confirmation" },
  ESCALATED: { tone: "danger", text: "Escalated" },
  DECIDED: { tone: "ok", text: "Decided" },
};

export function CoordinationStatusBadge({ status }: { status: string }) {
  const s = COORD_STATUS[status] ?? { tone: "neutral" as Tone, text: status };
  const icon = status === "DECIDED" ? <CheckCircle2 size={12} aria-hidden /> : status === "ESCALATED" ? <TrendingUp size={12} aria-hidden /> : <Clock size={12} aria-hidden />;
  return <Badge tone={s.tone} icon={icon}>{s.text}</Badge>;
}

export function TransferStatusBadge({ status }: { status: string }) {
  if (status === "PROPOSED") return <Badge tone="warn" icon={<Clock size={12} aria-hidden />}>Awaiting acceptance</Badge>;
  if (status === "ACCEPTED") return <Badge tone="ok" icon={<CheckCircle2 size={12} aria-hidden />}>Accepted</Badge>;
  if (status === "RETURNED") return <Badge tone="neutral" icon={<ArrowLeftRight size={12} aria-hidden />}>Returned</Badge>;
  return <Badge>{status}</Badge>;
}

export function DueCell({ c }: { c: CaseRow }) {
  if (!c.expected_disposal) return <span className="text-muted">—</span>;
  if (c.bucket === "disposed" || c.bucket === "rejected") return <span className="text-muted tabular">{fmtDate(c.expected_disposal)}</span>;
  const wd = c.working_days_left;
  return (
    <span className="flex flex-col">
      <span className="tabular whitespace-nowrap">{fmtDate(c.expected_disposal)}</span>
      {c.overdue ? <span className="text-xs font-semibold text-danger">Overdue</span>
        : wd !== null && <span className={cx("text-xs", wd <= 3 ? "font-semibold text-warn" : "text-muted")}>{wd} working day{wd === 1 ? "" : "s"} left</span>}
    </span>
  );
}

export function CaseFlags({ c, max }: { c: CaseRow; max?: number }) {
  const flags: ReactNode[] = [];
  if (c.overlaps.parallel_open > 0) flags.push(<Badge key="p" tone="danger" icon={<Flag size={12} aria-hidden />}>Coordination required</Badge>);
  if (c.overlaps.other_open > 0) flags.push(<Badge key="l" tone="coord" icon={<Link2 size={12} aria-hidden />}>{c.overlaps.other_open} linked</Badge>);
  if (c.transfer_to) flags.push(<Badge key="t" tone="warn" icon={<ArrowLeftRight size={12} aria-hidden />}>To {c.transfer_to}</Badge>);
  if (c.escalated) flags.push(<Badge key="e" tone="danger" icon={<TrendingUp size={12} aria-hidden />}>Escalated</Badge>);
  if (c.resolution_status !== "RESOLVED") flags.push(<Badge key="r" tone="warn" icon={<HelpCircle size={12} aria-hidden />}>Institution unconfirmed</Badge>);
  if (c.sensitivity !== "NORMAL") flags.push(<Badge key="s" icon={<Lock size={12} aria-hidden />}>{c.sensitivity.toLowerCase()}</Badge>);
  const shown = max ? flags.slice(0, max) : flags;
  return (
    <span className="flex flex-wrap gap-1">
      {shown}
      {max && flags.length > max && <Badge>+{flags.length - max}</Badge>}
    </span>
  );
}

/** Why two cases were linked: each matching feature with its signed log-odds weight, strongest first. */
export function EvidenceList({ reasons, compact }: { reasons: Reason[]; compact?: boolean }) {
  const shown = reasons
    .filter((r) => r.code !== "corroborated" && (r.weight !== 0 || r.code === "text_not_compared" || r.code === "parallel_rule"))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  if (shown.length === 0) return <p className="text-xs text-muted">No matching evidence was recorded.</p>;
  if (compact) {
    return (
      <ul className="flex flex-wrap gap-1.5" aria-label="Matching evidence">
        {shown.slice(0, 4).map((r) => (
          <li key={r.code + r.label} className={cx("rounded-md px-2 py-0.5 text-[11px] font-medium",
            r.code === "parallel_rule" ? "bg-danger-soft text-danger-ink" : r.weight > 0 ? "bg-ok-soft text-ok-ink" : "bg-surface-2 text-muted")}>
            {r.weight > 0 ? "+ " : r.weight < 0 ? "− " : ""}{r.label}
          </li>
        ))}
        {shown.length > 4 && <li className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-muted">+{shown.length - 4} more</li>}
      </ul>
    );
  }
  const max = Math.max(1, ...shown.map((r) => Math.abs(r.weight)));
  return (
    <ul className="flex flex-col gap-2" aria-label="Matching evidence">
      {shown.map((r) => {
        const pos = r.weight > 0;
        return (
          <li key={r.code + r.label} className="grid grid-cols-[minmax(0,1fr)_88px_44px] items-center gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className={cx("grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] font-bold",
                r.code === "parallel_rule" ? "bg-danger-soft text-danger" : pos ? "bg-ok-soft text-ok" : r.weight < 0 ? "bg-surface-2 text-muted" : "bg-warn-soft text-warn")} aria-hidden>
                {r.code === "parallel_rule" ? "!" : pos ? "+" : r.weight < 0 ? "−" : "·"}
              </span>
              <span className={cx("min-w-0", r.weight < 0 && "text-muted")}>{r.label}</span>
            </span>
            <span className="h-1.5 rounded-full bg-surface-2" aria-hidden>
              <span className={cx("block h-1.5 rounded-full", pos ? "bg-ok" : "bg-rule-strong")} style={{ width: `${Math.max(6, (Math.abs(r.weight) / max) * 100)}%` }} />
            </span>
            <span className="text-right text-xs tabular text-muted">{r.weight === 0 ? "rule" : `${pos ? "+" : ""}${r.weight.toFixed(1)}`}</span>
          </li>
        );
      })}
    </ul>
  );
}
