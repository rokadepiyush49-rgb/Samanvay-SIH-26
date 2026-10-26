"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftRight, CheckCircle2, Undo2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { api, useApi } from "@/lib/api";
import {
  actionSchema, noteSchema, returnTransferSchema, transferSchema, type ActionForm, type NoteForm, type ReturnTransferForm, type TransferForm,
} from "@/lib/schemas";
import { useUnsavedChanges } from "@/lib/session";
import type { AllowedAction, Meta } from "@/lib/types";
import { Button, ErrorNote, Field, Modal, cx, fieldA11y, inputCls } from "./ui";

/** Plain state-machine action (not consequential): remarks when required, optional next action. */
export function ActionDialog({ caseNo, version, action, onClose, onDone }: { caseNo: string; version: number; action: AllowedAction | null; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty } } = useForm<ActionForm>({
    resolver: zodResolver(actionSchema(!!action?.requires_remarks)), defaultValues: { remarks: "", next_action: "", next_action_due: "" },
  });
  useUnsavedChanges(`action-${caseNo}`, isDirty);
  if (!action) return null;
  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await api(`/cases/${caseNo}/actions`, {
        json: { action: action.action, remarks: v.remarks || null, next_action: v.next_action || undefined, next_action_due: v.next_action_due || undefined },
        headers: { "if-match": String(version) },
      });
      onDone();
    } catch (e) {
      setError(e);
    }
  });
  return (
    <Modal open onClose={onClose} title={action.label} description={`Moves the case to “${action.to_status.replaceAll("_", " ").toLowerCase()}”. The entry is added to the timeline and the audit chain.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="action-form" busy={isSubmitting}>Record action</Button></>}>
      <form id="action-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field id="a-remarks" label="Remarks" required={action.requires_remarks} error={errors.remarks?.message}>
          <textarea {...register("remarks")} {...fieldA11y("a-remarks", errors.remarks?.message)} className={cx(inputCls, "min-h-24")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
          <Field id="a-next" label="Next action (optional)"><input {...register("next_action")} id="a-next" className={inputCls} placeholder="e.g. Await institution's reply" /></Field>
          <Field id="a-due" label="Next action due"><input {...register("next_action_due")} id="a-due" type="date" className={inputCls} /></Field>
        </div>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

export function TransferDialog({ caseNo, version, holder, open, onClose, onDone }: { caseNo: string; version: number; holder: string; open: boolean; onClose: () => void; onDone: (to: string) => void }) {
  const { data: meta } = useApi<Meta>(open ? "/meta" : null);
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting, isDirty } } = useForm<TransferForm>({ resolver: zodResolver(transferSchema), defaultValues: { to_unit: "", reason: "" } });
  useUnsavedChanges(`transfer-${caseNo}`, open && isDirty);
  const close = () => { reset(); setError(null); onClose(); };
  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await api(`/cases/${caseNo}/transfers`, { json: v, headers: { "if-match": String(version) } });
      reset();
      onDone(v.to_unit);
    } catch (e) {
      setError(e);
    }
  });
  return (
    <Modal open={open} onClose={close} title="Propose transfer"
      description={`Custody handshake: the case stays with ${holder} until the receiving unit accepts it. Reminder after 2 working days, escalation after 5.`}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button type="submit" form="transfer-form" busy={isSubmitting} icon={<ArrowLeftRight size={15} aria-hidden />}>Send for acceptance</Button></>}>
      <form id="transfer-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field id="t-unit" label="Receiving unit" required error={errors.to_unit?.message}>
          <select {...register("to_unit")} {...fieldA11y("t-unit", errors.to_unit?.message)} className={inputCls}>
            <option value="">Choose a unit</option>
            {meta?.units.filter((u) => u.code !== holder).map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}
          </select>
        </Field>
        <Field id="t-reason" label="Reason for transfer" required error={errors.reason?.message} hint="The receiving unit reads this before accepting.">
          <textarea {...register("reason")} {...fieldA11y("t-reason", errors.reason?.message, true)} className={cx(inputCls, "min-h-24")} />
        </Field>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

/** Accept (optional remarks) or return (reason required) a proposed transfer. The case moves only when the API confirms. */
export function TransferDecisionDialog({ transfer, mode, onClose, onDone }:
  { transfer: { id: string; case_no: string; from_unit: string; to_unit: string } | null; mode: "accept" | "return"; onClose: () => void; onDone: (msg: string) => void }) {
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ReturnTransferForm>({
    resolver: mode === "return" ? zodResolver(returnTransferSchema) : undefined, defaultValues: { remarks: "" },
  });
  if (!transfer) return null;
  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      const out = await api<{ status: string; case_no: string }>(`/transfers/${transfer.id}/${mode}`, { json: { remarks: v.remarks || null } });
      onDone(mode === "accept" ? `${out.case_no} accepted. Custody is now with ${transfer.to_unit}.` : `${out.case_no} returned to ${transfer.from_unit} with your reason.`);
    } catch (e) {
      setError(e);
    }
  });
  return (
    <Modal open onClose={onClose} size="sm"
      title={mode === "accept" ? `Accept ${transfer.case_no}?` : `Return ${transfer.case_no}?`}
      description={mode === "accept"
        ? `Your unit (${transfer.to_unit}) becomes the custodian and the case is assigned to an officer. This is recorded in both units' history.`
        : `Custody stays with ${transfer.from_unit}. The case returns to its previous status and ${transfer.from_unit} sees your reason.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="td-form" busy={isSubmitting} variant={mode === "accept" ? "primary" : "danger"} icon={mode === "accept" ? <CheckCircle2 size={15} aria-hidden /> : <Undo2 size={15} aria-hidden />}>
          {mode === "accept" ? "Accept transfer" : "Return transfer"}
        </Button></>}>
      <form id="td-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field id="td-remarks" label={mode === "accept" ? "Remarks (optional)" : "Reason for returning"} required={mode === "return"} error={errors.remarks?.message}>
          <textarea {...register("remarks")} {...fieldA11y("td-remarks", errors.remarks?.message)} className={cx(inputCls, "min-h-20")} />
        </Field>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

export function NoteDialog({ caseNo, open, onClose, onDone }: { caseNo: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting, isDirty } } = useForm<NoteForm>({
    resolver: zodResolver(noteSchema), defaultValues: { kind: "NOTE", remarks: "", next_action: "", next_action_due: "" },
  });
  useUnsavedChanges(`note-${caseNo}`, open && isDirty);
  const close = () => { reset(); setError(null); onClose(); };
  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await api(`/cases/${caseNo}/notes`, { json: { ...v, next_action: v.next_action || undefined, next_action_due: v.next_action_due || undefined } });
      reset();
      onDone();
    } catch (e) {
      setError(e);
    }
  });
  return (
    <Modal open={open} onClose={close} title="Add to the case file"
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button type="submit" form="note-form" busy={isSubmitting}>Save entry</Button></>}>
      <form id="note-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field id="n-kind" label="Entry type">
          <select {...register("kind")} id="n-kind" className={inputCls}>
            <option value="NOTE">Internal note (AICTE only)</option>
            <option value="INTERIM_REPLY_SENT">Interim reply sent to complainant</option>
            <option value="NEXT_ACTION">Set next action</option>
          </select>
        </Field>
        <Field id="n-remarks" label="Remarks" required error={errors.remarks?.message}>
          <textarea {...register("remarks")} {...fieldA11y("n-remarks", errors.remarks?.message)} className={cx(inputCls, "min-h-24")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
          <Field id="n-next" label="Next action"><input {...register("next_action")} id="n-next" className={inputCls} /></Field>
          <Field id="n-due" label="Next action due"><input {...register("next_action_due")} id="n-due" type="date" className={inputCls} /></Field>
        </div>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

export function RevealDialog({ caseNo, open, onClose }: { caseNo: string; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [out, setOut] = useState<{ name: string | null; contact: string | null; notice: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const close = () => { setOut(null); setReason(""); setError(null); onClose(); };
  const go = async () => {
    setBusy(true);
    try {
      setOut(await api(`/cases/${caseNo}/complainant`, { json: { reason } }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const tooShort = reason.trim().length < 10;
  return (
    <Modal open={open} onClose={close} size="sm" title="Reveal complainant identity" description="Identity is encrypted at rest. Every reveal is written to the audit chain with your reason."
      footer={out ? <Button onClick={close}>Done</Button> : <><Button variant="ghost" onClick={close}>Cancel</Button><Button busy={busy} disabled={tooShort} onClick={go}>Reveal</Button></>}>
      {out ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">Name</dt><dd className="font-medium">{out.name ?? "—"}</dd>
          <dt className="text-muted">Contact</dt><dd className="font-medium">{out.contact ?? "—"}</dd>
          <dd className="col-span-2 mt-2 rounded-lg bg-warn-soft px-3 py-2 text-warn-ink">{out.notice}</dd>
        </dl>
      ) : (
        <div className="flex flex-col gap-3">
          <Field id="rv-reason" label="Reason" required hint="At least 10 characters, e.g. “Phone call to confirm hearing date”.">
            <input {...fieldA11y("rv-reason", undefined, true)} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={error} />
        </div>
      )}
    </Modal>
  );
}
