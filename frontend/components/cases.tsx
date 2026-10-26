"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ago, CHANNEL_LABEL } from "@/lib/format";
import { nextStep } from "@/lib/priority";
import type { CaseRow } from "@/lib/types";
import { CaseFlags, DueCell, PriorityIndicator, StatusBadge } from "./status";
import { cx, rowClick } from "./ui";

export type CaseColumn = "priority" | "case" | "institution" | "category" | "status" | "holder" | "due" | "updated" | "next" | "flags";

const HEAD: Record<CaseColumn, string> = {
  priority: "Priority", case: "Case", institution: "Institution", category: "Category", status: "Status", holder: "Held by",
  due: "Deadline", updated: "Last updated", next: "Next action", flags: "Alerts",
};

// Lower-priority columns drop off at narrower widths; the table also scrolls horizontally.
const WIDTH: Partial<Record<CaseColumn, string>> = { case: "min-w-[12rem]", institution: "min-w-[14rem]", category: "min-w-[11rem]", status: "min-w-[9rem]", due: "min-w-[8.5rem]" };

const HIDE: Partial<Record<CaseColumn, string>> = {
  category: "hidden lg:table-cell", updated: "hidden xl:table-cell", next: "hidden xl:table-cell", flags: "hidden md:table-cell", holder: "hidden md:table-cell",
};

export const REGISTER_COLUMNS: CaseColumn[] = ["case", "institution", "category", "holder", "status", "due", "updated", "flags"];
export const WORKLIST_COLUMNS: CaseColumn[] = ["priority", "case", "institution", "category", "status", "due", "updated", "next"];

function Cell({ c, col }: { c: CaseRow; col: CaseColumn }) {
  switch (col) {
    case "priority":
      return <PriorityIndicator c={c} />;
    case "case":
      return (
        <>
                    <Link href={`/cases/${c.case_no}`} className="font-mono text-[13px] font-semibold text-action-ink hover:underline">{c.case_no}</Link>
          <p className="mt-0.5 max-w-[26ch] truncate text-xs text-muted" title={c.subject ?? undefined}>
            {c.full_access ? c.subject : <span className="inline-flex items-center gap-1"><Lock size={11} aria-hidden />Content restricted to holding unit</span>}
          </p>
        </>
      );
    case "institution":
      return c.institution ? (
        <>
          <Link href={`/institutions/${c.institution.permanent_id}`} className="font-medium hover:underline">{c.institution.name}</Link>
          <p className="text-xs text-muted">{c.institution.city ? `${c.institution.city} · ` : ""}<span className="font-mono">{c.institution.permanent_id}</span></p>
        </>
      ) : (
        <>
          <span className="italic text-muted">{c.institution_raw ?? "Not identified"}</span>
          <p className="text-xs text-warn">Needs confirmation</p>
        </>
      );
    case "category":
      return (
        <>
          <p>{c.category.name}</p>
          <p className="text-xs text-muted">{CHANNEL_LABEL[c.channel] ?? c.channel}{c.source_ref ? ` · ${c.source_ref}` : ""}</p>
        </>
      );
    case "status":
      return <StatusBadge bucket={c.bucket} label={c.status_label} />;
    case "holder":
      return (
        <>
          <p className="font-semibold">{c.holding_unit.code}</p>
          <p className="text-xs text-muted">{c.holding_officer?.name ?? "Unassigned"}</p>
        </>
      );
    case "due":
      return <DueCell c={c} />;
    case "updated":
      return <span className="whitespace-nowrap text-xs text-muted" title={c.last_action_at ?? undefined}>{c.last_action_at ? ago(c.last_action_at) : "—"}</span>;
    case "next": {
      const s = nextStep(c);
      if (!s) return <span className="text-muted">—</span>;
      return <span className={cx("block max-w-[24ch] text-xs", s.suggested ? "italic text-muted" : "text-ink")} title={s.suggested ? "Suggested from the case state; not recorded on the case" : undefined}>{s.suggested ? `Suggested: ${s.text}` : s.text}</span>;
    }
    case "flags":
      return <CaseFlags c={c} max={2} />;
  }
}

export function CaseTable({ rows, columns = REGISTER_COLUMNS, caption = "Cases" }: { rows: CaseRow[]; columns?: CaseColumn[]; caption?: string }) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto rounded-xl border border-rule bg-surface shadow-card">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-2/70">
          <tr className="border-b border-rule text-xs text-muted">
            {columns.map((col) => <th key={col} scope="col" className={cx("whitespace-nowrap px-4 py-2.5 font-semibold", HIDE[col])}>{HEAD[col]}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} onClick={rowClick(() => router.push(`/cases/${c.case_no}`))} className="cursor-pointer border-b border-rule transition-colors last:border-0 hover:bg-action-soft/40" data-testid="case-row">
              {columns.map((col) => <td key={col} className={cx("px-4 py-3 align-top", HIDE[col], WIDTH[col])}><Cell c={c} col={col} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
