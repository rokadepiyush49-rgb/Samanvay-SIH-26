"use client";

import { Ban, CheckCircle2, Info, Lock, Network, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { guardReasonSchema } from "@/lib/schemas";
import type { AllowedAction, GuardResult } from "@/lib/types";
import { OverlapTypeBadge } from "./status";
import { Badge, Button, ErrorNote, Field, Modal, Spinner, cx, fieldA11y, inputCls } from "./ui";

export type GuardLevel = "approved" | "info" | "review" | "blocked";

/**
 * The four outcomes an officer can see. The API decides the result and the allowed choices; the UI only presents
 * them. "Blocked" appears when the API offers no proceed choice at all.
 */
export function guardLevel(g: Pick<GuardResult, "result" | "choices">): GuardLevel {
  if (!g.choices.some((c) => c.startsWith("PROCEED"))) return "blocked";
  if (g.result === "NO_CONFLICT") return "approved";
  if (g.result === "COORDINATED") return "info";
  return "review";
}

const LEVEL: Record<GuardLevel, { title: string; tone: string; icon: ReactNode; resolution: string }> = {
  approved: {
    title: "Approved to proceed",
    tone: "border-ok/30 bg-ok-soft text-ok-ink",
    icon: <ShieldCheck size={22} aria-hidden />,
    resolution: "No open matter in another unit concerns this institution. You can record the action.",
  },
  info: {
    title: "Informational — coordination already decided",
    tone: "border-action/30 bg-action-soft text-action-ink",
    icon: <Info size={22} aria-hidden />,
    resolution: "Other units hold matters on this institution, but the overlap has been jointly decided. Follow the lead unit's plan when you act.",
  },
  review: {
    title: "Review required — Potential Overlapping Cases, Coordination Required",
    tone: "border-coord/30 bg-coord-soft text-coord-ink",
    icon: <ShieldAlert size={22} aria-hidden />,
    resolution: "Another unit holds an undecided matter on this institution. Coordinate first, or record why this action cannot wait; the other units are then notified.",
  },
  blocked: {
    title: "Action blocked pending resolution",
    tone: "border-danger/30 bg-danger-soft text-danger-ink",
    icon: <Ban size={22} aria-hidden />,
    resolution: "This action cannot be recorded until the coordination is resolved. Open the coordination card to resolve it.",
  },
};

export function GuardSummary({ guard, action }: { guard: GuardResult; action: AllowedAction }) {
  const level = guardLevel(guard);
  const L = LEVEL[level];
  const units = [...new Set(guard.other_matters.map((m) => m.unit_code))];
  return (
    <div className="flex flex-col gap-4" data-testid="guard-summary" data-level={level}>
      <div className={cx("flex items-start gap-3 rounded-lg border p-4", L.tone)} role={level === "review" || level === "blocked" ? "alert" : "status"}>
        <span className="mt-0.5 shrink-0">{L.icon}</span>
        <div>
          <p className="font-semibold">{L.title}</p>
          <p className="mt-0.5 text-sm">{L.resolution}</p>
        </div>
      </div>
      <dl className="grid gap-3 rounded-lg border border-rule p-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted">Proposed action</dt><dd className="font-semibold">{action.label}</dd><dd className="text-xs text-muted">moves the case to {action.to_status.replaceAll("_", " ").toLowerCase()}</dd></div>
        <div><dt className="text-xs text-muted">Units with related matters</dt><dd className="font-semibold">{units.length ? units.join(", ") : "None"}</dd></div>
      </dl>
      {guard.other_matters.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Related cases and why they were flagged</p>
          <ul className="flex flex-col gap-2">
            {guard.other_matters.map((m) => (
              <li key={m.case_no} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rule bg-surface-2/60 px-3.5 py-2.5 text-sm">
                <span className="min-w-0">
                  <Link href={`/cases/${m.case_no}`} className="font-mono font-semibold text-action-ink hover:underline">{m.case_no}</Link>
                  <span className="text-muted"> · {m.unit_code} · {m.status_label}</span>
                  <span className="block text-xs text-muted">
                    {m.category}
                    {m.coordination_code && <> · coordination <Link className="font-mono underline" href={`/coordination/${m.coordination_code}`}>{m.coordination_code}</Link></>}
                    {m.lead_unit && ` · ${m.lead_unit} leads`}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <OverlapTypeBadge type={m.link_type} prob={m.probability ?? undefined} />
                  {m.decided ? <Badge tone="ok" icon={<CheckCircle2 size={12} aria-hidden />}>Decided</Badge> : <Badge tone="danger" icon={<Network size={12} aria-hidden />}>Undecided</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {guard.restricted_note && <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3.5 py-2.5 text-sm"><Lock size={15} aria-hidden />{guard.restricted_note}</p>}
      {guard.fallback_note && <p className="text-xs text-muted">{guard.fallback_note}</p>}
    </div>
  );
}

/** Runs the Action Conflict Guard before a consequential action and records the officer's choice with the action. */
export function GuardDialog({ caseNo, action, onClose, onDone }: { caseNo: string; action: AllowedAction | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [guard, setGuard] = useState<GuardResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [remarks, setRemarks] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [opened, setOpened] = useState<string[] | null>(null);

  // The parent remounts this dialog (key) for every new action, so state starts fresh each time.
  useEffect(() => {
    if (!action) return;
    api<GuardResult>(`/cases/${caseNo}/guard-check`, { json: { action_type: action.action } }).then(setGuard).catch(setError);
  }, [action, caseNo]);
  if (!action) return null;

  const level = guard ? guardLevel(guard) : null;
  const reasonError = level === "review" && touched ? guardReasonSchema.safeParse(reason).error?.issues[0]?.message : undefined;
  const remarksMissing = action.requires_remarks && !remarks.trim();

  const proceed = async (choice: "PROCEED" | "PROCEED_AND_NOTIFY") => {
    if (!guard) return;
    if (choice === "PROCEED_AND_NOTIFY" && !guardReasonSchema.safeParse(reason).success) return setTouched(true);
    setBusy(choice);
    setError(null);
    try {
      await api(`/cases/${caseNo}/actions`, { json: { action: action.action, remarks: remarks || null, guard_check_id: guard.guard_check_id, guard_choice: choice, guard_reason: reason || null } });
      onDone(choice === "PROCEED_AND_NOTIFY" ? `${action.label} recorded. The other units have been notified.` : `${action.label} recorded.`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const choose = async (choice: "OPEN_COORDINATION" | "CANCEL") => {
    if (!guard) return;
    setBusy(choice);
    try {
      const out = await api<{ coordinations: string[] }>(`/guard-checks/${guard.guard_check_id}/choice`, { json: { choice, reason: reason || null } });
      if (choice === "CANCEL") onClose();
      else setOpened(out.coordinations);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const footer = guard && !opened ? (
    <>
      {guard.choices.includes("CANCEL") && <Button variant="ghost" busy={busy === "CANCEL"} onClick={() => choose("CANCEL")}>Cancel action</Button>}
      {guard.choices.includes("OPEN_COORDINATION") && <Button variant="coord" busy={busy === "OPEN_COORDINATION"} onClick={() => choose("OPEN_COORDINATION")} icon={<Network size={15} aria-hidden />}>Coordinate first</Button>}
      {guard.choices.includes("PROCEED_AND_NOTIFY") && (
        <Button variant="danger" busy={busy === "PROCEED_AND_NOTIFY"} disabled={remarksMissing} onClick={() => proceed("PROCEED_AND_NOTIFY")}>Proceed and notify units</Button>
      )}
      {guard.choices.includes("PROCEED") && <Button busy={busy === "PROCEED"} disabled={remarksMissing} onClick={() => proceed("PROCEED")}>Record {action.label.toLowerCase()}</Button>}
    </>
  ) : opened ? <Button onClick={onClose}>Close</Button> : undefined;

  return (
    <Modal open onClose={onClose} size="lg" title={`Action Conflict Guard · ${action.label}`}
      description="Checked against every open matter on this institution in other units before the action is recorded." footer={footer}>
      {!guard && !error && <Spinner label="Checking other units' matters on this institution…" />}
      <ErrorNote error={error} />
      {guard && (
        <div className="flex flex-col gap-4">
          <GuardSummary guard={guard} action={action} />
          {opened ? (
            <div className="rounded-lg border border-coord/30 bg-coord-soft p-4 text-sm text-coord-ink" role="status">
              <p className="font-semibold">Coordination opened. The action was not recorded.</p>
              <p className="mt-1">{opened.length ? <>Continue in {opened.map((c) => <Link key={c} href={`/coordination/${c}`} className="mr-2 font-mono font-semibold underline">{c}</Link>)}</> : "Existing coordination cards already cover these matters."}</p>
            </div>
          ) : level !== "blocked" && (
            <div className="grid gap-4">
              <Field id="g-remarks" label="Remarks for the action" required={action.requires_remarks} error={touched && remarksMissing ? "Remarks are required for this action." : undefined}>
                <textarea {...fieldA11y("g-remarks", touched && remarksMissing ? "x" : undefined)} className={cx(inputCls, "min-h-20")} value={remarks} onChange={(e) => setRemarks(e.target.value)} onBlur={() => setTouched(true)} />
              </Field>
              {level === "review" && (
                <Field id="g-reason" label="Why this cannot wait for coordination" required error={reasonError}
                  hint="Needed only to proceed now. Shown to the other units and kept in the audit chain.">
                  <textarea {...fieldA11y("g-reason", reasonError, true)} className={cx(inputCls, "min-h-16")} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} placeholder="e.g. statutory hearing date falls tomorrow" />
                </Field>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
