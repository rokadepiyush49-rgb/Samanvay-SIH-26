"use client";

import Link from "next/link";
import { CHANNEL_LABEL, fmtDate } from "@/lib/format";
import type { CaseRow, Reason } from "@/lib/types";
import { IconLock } from "./icons";
import { Badge, StatusChip, Table, cx } from "./ui";

export function DueCell({ c }: { c: CaseRow }) {
  if (!c.expected_disposal) return <span className="text-muted">—</span>;
  if (c.bucket === "disposed" || c.bucket === "rejected") return <span className="text-muted">{fmtDate(c.expected_disposal)}</span>;
  const wd = c.working_days_left;
  return (
    <span className="flex flex-col">
      <span className="tabular">{fmtDate(c.expected_disposal)}</span>
      {c.overdue ? <span className="text-xs font-bold text-danger">▲ overdue</span>
        : wd !== null && <span className={cx("text-xs", wd <= 3 ? "font-bold text-yellow-ink" : "text-muted")}>{wd} working days</span>}
    </span>
  );
}

export function CaseFlags({ c }: { c: CaseRow }) {
  return (
    <span className="flex flex-wrap gap-1">
      {c.overlaps.parallel_open > 0 && <Badge tone="danger">⚑ Coordination required</Badge>}
      {c.overlaps.other_open > 0 && <Badge tone="info">◇ Linked {c.overlaps.other_open}</Badge>}
      {c.transfer_to && <Badge tone="warn">⇄ To {c.transfer_to}</Badge>}
      {c.escalated && <Badge tone="danger">↑ Escalated</Badge>}
      {c.resolution_status !== "RESOLVED" && <Badge tone="warn">? Institution unconfirmed</Badge>}
      {c.sensitivity !== "NORMAL" && <Badge><IconLock size={12} />{c.sensitivity.toLowerCase()}</Badge>}
    </span>
  );
}

export function CaseTable({ rows, showUnit = true }: { rows: CaseRow[]; showUnit?: boolean }) {
  return (
    <Table head={["Case", "Institution", "Category · channel", ...(showUnit ? ["Held by"] : []), "Status", "Due", "Flags"]}>
      {rows.map((c) => (
        <tr key={c.id} className="hover:bg-surface-2">
          <td>
            <Link href={`/cases/${c.case_no}`} className="font-mono text-[13px] font-bold text-sky-ink underline-offset-2 hover:underline">{c.case_no}</Link>
            <p className="mt-0.5 max-w-[22ch] truncate text-xs text-muted" title={c.subject ?? undefined}>{c.subject ?? "Content visible to the holding unit"}</p>
          </td>
          <td>
            {c.institution ? (
              <Link href={`/institutions/${c.institution.permanent_id}`} className="font-semibold hover:underline">{c.institution.name}</Link>
            ) : <span className="italic text-muted">{c.institution_raw ?? "Unresolved"}</span>}
            <p className="text-xs text-muted">{c.institution ? `${c.institution.city ?? ""} · ${c.institution.permanent_id}` : "needs confirmation"}</p>
          </td>
          <td>
            <p>{c.category.name}</p>
            <p className="text-xs text-muted">{CHANNEL_LABEL[c.channel] ?? c.channel} · received {fmtDate(c.received_on)}</p>
          </td>
          {showUnit && (
            <td>
              <p className="font-bold">{c.holding_unit.code}</p>
              <p className="text-xs text-muted">{c.holding_officer?.name ?? "Unassigned"}</p>
            </td>
          )}
          <td><StatusChip bucket={c.bucket} label={c.status_label} /></td>
          <td><DueCell c={c} /></td>
          <td><CaseFlags c={c} /></td>
        </tr>
      ))}
    </Table>
  );
}

/** Why two cases were linked: each feature with its signed log-odds weight. */
export function ReasonList({ reasons, compact }: { reasons: Reason[]; compact?: boolean }) {
  const shown = reasons.filter((r) => r.code !== "corroborated" && (r.weight !== 0 || r.code === "text_not_compared" || r.code === "parallel_rule"));
  return (
    <ul className={cx("flex flex-wrap gap-1.5", compact ? "text-[11px]" : "text-xs")}>
      {shown.map((r) => (
        <li key={r.code + r.label} className={cx("rounded-full px-2.5 py-1 font-semibold",
          r.code === "parallel_rule" ? "bg-pink text-pink-ink" : r.weight > 0 ? "bg-mint text-mint-ink" : r.weight < 0 ? "bg-surface-2 text-muted line-through decoration-1" : "bg-cream text-ink")}>
          {r.label}{r.weight !== 0 && <span className="tabular"> {r.weight > 0 ? "+" : ""}{r.weight.toFixed(1)}</span>}
        </li>
      ))}
    </ul>
  );
}
