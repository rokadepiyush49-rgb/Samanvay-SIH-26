"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/api";
import type { Meta } from "@/lib/types";
import { IconLock, IconStop } from "./icons";
import { Badge, Button, ErrorNote, Field, Modal, Spinner, TypeBadge, inputCls, cx } from "./ui";

export type AllowedAction = { action: string; label: string; to_status: string; requires_remarks: boolean; consequential: boolean };

type Guard = {
  guard_check_id: string;
  action: string;
  result: "NO_CONFLICT" | "COORDINATION_SUGGESTED" | "COORDINATED";
  other_matters: { case_no: string; unit_code: string; status_label: string; category: string; link_type: string; probability: number | null; decided: boolean; coordination_code: string | null; lead_unit: string | null; decision: string | null }[];
  restricted_matter_exists: boolean;
  restricted_note: string | null;
  fallback: boolean;
  fallback_note: string | null;
  choices: string[];
};

/** Plain state-machine action: remarks when required, optional next action. */
export function ActionDialog({ caseNo, version, action, onClose, onDone }: { caseNo: string; version: number; action: AllowedAction | null; onClose: () => void; onDone: () => void }) {
  const [remarks, setRemarks] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!action) return null;
  const go = async () => {
    setBusy(true);
    try {
      await api(`/cases/${caseNo}/actions`, { json: { action: action.action, remarks: remarks || null, next_action: nextAction || undefined }, headers: { "if-match": String(version) } });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={action.label}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Moves the case to <b>{action.to_status.replaceAll("_", " ").toLowerCase()}</b>. The entry is added to the timeline and the audit chain.</p>
        <Field label="Remarks" required={action.requires_remarks}><textarea className={cx(inputCls, "min-h-24")} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        <Field label="Next action (optional)"><input className={inputCls} value={nextAction} onChange={(e) => setNextAction(e.target.value)} /></Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={go} disabled={action.requires_remarks && !remarks.trim()}>Record action</Button></div>
      </div>
    </Modal>
  );
}

/** Action Conflict Guard (wow factor W1): runs before every consequential action and records the officer's choice. */
export function GuardDialog({ caseNo, action, onClose, onDone }: { caseNo: string; action: AllowedAction | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [guard, setGuard] = useState<Guard | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [remarks, setRemarks] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [opened, setOpened] = useState<string[] | null>(null);

  // The parent remounts this dialog (key) for every new action, so state starts fresh each time.
  useEffect(() => {
    if (!action) return;
    api<Guard>(`/cases/${caseNo}/guard-check`, { json: { action_type: action.action } }).then(setGuard).catch(setError);
  }, [action, caseNo]);
  if (!action) return null;

  const proceed = async (choice: "PROCEED" | "PROCEED_AND_NOTIFY") => {
    if (!guard) return;
    setBusy(choice);
    setError(null);
    try {
      await api(`/cases/${caseNo}/actions`, { json: { action: action.action, remarks, guard_check_id: guard.guard_check_id, guard_choice: choice, guard_reason: reason || null } });
      onDone(choice === "PROCEED_AND_NOTIFY" ? `${action.label} recorded; the other units have been notified.` : `${action.label} recorded.`);
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

  const conflict = guard?.result === "COORDINATION_SUGGESTED";
  return (
    <Modal open onClose={onClose} title={`Action Conflict Guard · ${action.label}`} wide>
      {!guard && !error && <Spinner label="Checking other units' matters on this institution…" />}
      <ErrorNote error={error} />
      {guard && (
        <div className="flex flex-col gap-4">
          <div className={cx("flex items-start gap-3 rounded-2xl p-4", conflict ? "bg-pink text-pink-ink" : "bg-mint text-mint-ink")}>
            {conflict && <IconStop size={22} className="mt-0.5 shrink-0" />}
            <div>
              <p className="font-bold">
                {guard.result === "NO_CONFLICT" && "No open matters in other units. You can proceed."}
                {guard.result === "COORDINATED" && "Other units' matters exist, and coordination has been decided."}
                {conflict && "Potential Overlapping Cases – Coordination Required"}
              </p>
              {conflict && <p className="text-sm">Another unit holds an open matter on this institution that has not been jointly decided. Coordinate first, or record why this cannot wait.</p>}
            </div>
          </div>
          {guard.other_matters.length > 0 && (
            <ul className="flex flex-col gap-2">
              {guard.other_matters.map((m) => (
                <li key={m.case_no} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rule bg-surface-2 px-4 py-3 text-sm">
                  <span>
                    <span className="font-mono font-bold">{m.case_no}</span> · <b>{m.unit_code}</b> · {m.status_label}
                    <span className="block text-xs text-muted">{m.category}{m.coordination_code ? ` · ${m.coordination_code}` : ""}{m.lead_unit ? ` · ${m.lead_unit} leads` : ""}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <TypeBadge type={m.link_type} prob={m.probability ?? undefined} />
                    {m.decided ? <Badge tone="ok">✓ decided</Badge> : <Badge tone="danger">● undecided</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {guard.restricted_note && <p className="flex items-center gap-2 rounded-2xl bg-cream px-4 py-3 text-sm font-semibold"><IconLock size={16} />{guard.restricted_note}</p>}
          {guard.fallback_note && <p className="text-xs text-muted">{guard.fallback_note}</p>}

          {opened ? (
            <div className="rounded-2xl bg-sky p-4 text-sm text-sky-ink">
              <p className="font-bold">Coordination opened. The action was not taken.</p>
              <p className="mt-1">{opened.length ? opened.map((c) => <Link key={c} href={`/coordination/${c}`} className="mr-2 font-mono font-bold underline">{c}</Link>) : "Existing coordination cards cover these matters."}</p>
            </div>
          ) : (
            <>
              <Field label="Remarks for the action" required={action.requires_remarks}><textarea className={cx(inputCls, "min-h-20")} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
              {conflict && <Field label="Reason for proceeding before coordination" hint="Mandatory to proceed; shown to the other unit and kept in the audit chain."><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. statutory deadline expires today" /></Field>}
              <div className="flex flex-wrap justify-end gap-2">
                {guard.choices.includes("CANCEL") && <Button variant="ghost" busy={busy === "CANCEL"} onClick={() => choose("CANCEL")}>Cancel action</Button>}
                {guard.choices.includes("OPEN_COORDINATION") && <Button variant="light" busy={busy === "OPEN_COORDINATION"} onClick={() => choose("OPEN_COORDINATION")}>Coordinate first</Button>}
                {guard.choices.includes("PROCEED_AND_NOTIFY") && (
                  <Button variant="danger" busy={busy === "PROCEED_AND_NOTIFY"} disabled={reason.trim().length < 10 || (action.requires_remarks && !remarks.trim())} onClick={() => proceed("PROCEED_AND_NOTIFY")}>Proceed and notify</Button>
                )}
                {guard.choices.includes("PROCEED") && (
                  <Button busy={busy === "PROCEED"} disabled={action.requires_remarks && !remarks.trim()} onClick={() => proceed("PROCEED")} arrow>Proceed</Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

export function TransferDialog({ caseNo, version, holder, open, onClose, onDone }: { caseNo: string; version: number; holder: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const { data: meta } = useApi<Meta>(open ? "/meta" : null);
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await api(`/cases/${caseNo}/transfers`, { json: { to_unit: unit, reason }, headers: { "if-match": String(version) } });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Propose transfer">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Custody handshake: the case stays with {holder} until the receiving unit accepts it (reminder after 2 working days, escalation after 5).</p>
        <Field label="Transfer to" required>
          <select className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">Choose a unit</option>
            {meta?.units.filter((u) => u.code !== holder).map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}
          </select>
        </Field>
        <Field label="Reason" required><textarea className={cx(inputCls, "min-h-20")} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!unit || reason.trim().length < 3} onClick={go}>Send for acceptance</Button></div>
      </div>
    </Modal>
  );
}

export function NoteDialog({ caseNo, open, onClose, onDone, interim }: { caseNo: string; open: boolean; onClose: () => void; onDone: () => void; interim?: boolean }) {
  const [kind, setKind] = useState<"NOTE" | "INTERIM_REPLY_SENT" | "NEXT_ACTION">(interim ? "INTERIM_REPLY_SENT" : "NOTE");
  const [remarks, setRemarks] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<unknown>(null);
  const go = async () => {
    try {
      await api(`/cases/${caseNo}/notes`, { json: { kind, remarks, next_action: nextAction || undefined, next_action_due: due || undefined } });
      setRemarks("");
      onDone();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add to the case file">
      <div className="flex flex-col gap-4">
        <Field label="Entry type">
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="NOTE">Internal note (AICTE only)</option>
            <option value="INTERIM_REPLY_SENT">Interim reply sent to complainant</option>
            <option value="NEXT_ACTION">Set next action</option>
          </select>
        </Field>
        <Field label="Remarks" required><textarea className={cx(inputCls, "min-h-24")} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Next action"><input className={inputCls} value={nextAction} onChange={(e) => setNextAction(e.target.value)} /></Field>
          <Field label="Next action due"><input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!remarks.trim()} onClick={go}>Save</Button></div>
      </div>
    </Modal>
  );
}
