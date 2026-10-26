import type { CaseRow } from "./types";

export type Priority = "critical" | "high" | "medium" | "low";

export const PRIORITY_LABEL: Record<Priority, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

const CLOSED = new Set(["disposed", "rejected"]);

export function isOpen(c: Pick<CaseRow, "bucket">): boolean {
  return !CLOSED.has(c.bucket);
}

/**
 * Display priority for worklists, derived from fields the API returns (deadline, escalation, overlap, transfer). It
 * orders the officer's desk; it is not stored and does not change any case.
 */
export function priorityOf(c: CaseRow): Priority {
  if (!isOpen(c)) return "low";
  const wd = c.working_days_left;
  if (c.overdue || c.escalated || c.overlaps.parallel_open > 0) return "critical";
  if ((wd !== null && wd <= 3) || c.transfer_to) return "high";
  if ((wd !== null && wd <= 7) || c.resolution_status !== "RESOLVED" || c.overlaps.other_open > 0) return "medium";
  return "low";
}

const RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Most urgent first; ties broken by working days left (nulls last), then by case number. */
export function byUrgency(a: CaseRow, b: CaseRow): number {
  const p = RANK[priorityOf(a)] - RANK[priorityOf(b)];
  if (p) return p;
  const wa = a.working_days_left ?? Number.POSITIVE_INFINITY;
  const wb = b.working_days_left ?? Number.POSITIVE_INFINITY;
  if (wa !== wb) return wa - wb;
  return a.case_no.localeCompare(b.case_no);
}

/** The recorded next action, or a suggestion derived from the case state (marked as such in the UI). */
export function nextStep(c: CaseRow): { text: string; suggested: boolean } | null {
  if (c.next_action) return { text: c.next_action, suggested: false };
  if (!isOpen(c)) return null;
  if (c.transfer_to) return { text: `Awaiting ${c.transfer_to} to accept transfer`, suggested: true };
  if (c.overlaps.parallel_open > 0) return { text: "Decide coordination with the other unit", suggested: true };
  if (c.resolution_status !== "RESOLVED") return { text: "Confirm the institution", suggested: true };
  if (c.overdue) return { text: "Dispose or record reasons for delay", suggested: true };
  if (c.status === "REGISTERED") return { text: "Start examination", suggested: true };
  return null;
}
