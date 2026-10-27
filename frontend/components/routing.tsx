"use client";

/**
 * Inter-bureau routing and assistance in the case workspace (ministry note pp. 13–15): a routing check that says
 * whether the holding unit should keep, transfer or ask for help — with its reasons — and requests for assistance
 * where the holding unit keeps the case. Advice only: an officer approves every transfer or request.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeftRight, CheckCircle2, Clock, HelpCircle, LifeBuoy, Network, Route, Send, ShieldCheck, Undo2, XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api, useApi } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { assistanceReplySchema, assistanceSchema, type AssistanceForm, type AssistanceReplyForm } from "@/lib/schemas";
import { useUnsavedChanges } from "@/lib/session";
import type { AssistanceKind, AssistanceRequest, CaseDetail, DirectoryEntry, Meta, RoutingRecommendation } from "@/lib/types";
import { EvidenceList } from "./status";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, cx, fieldA11y, inputCls, type Tone } from "./ui";

export const KIND_LABEL: Record<AssistanceKind, string> = {
  VERIFICATION: "Verification visit",
  INFORMATION: "Information or records",
  OPINION: "Opinion or advice",
  ACTION: "Action within its mandate",
};

const STATUS: Record<AssistanceRequest["status"], { tone: Tone; text: string; icon: ReactNode }> = {
  SENT: { tone: "warn", text: "Awaiting acknowledgement", icon: <Clock size={12} aria-hidden /> },
  ACCEPTED: { tone: "info", text: "In progress", icon: <LifeBuoy size={12} aria-hidden /> },
  COMPLETED: { tone: "ok", text: "Completed", icon: <CheckCircle2 size={12} aria-hidden /> },
  DECLINED: { tone: "neutral", text: "Declined", icon: <Undo2 size={12} aria-hidden /> },
  CANCELLED: { tone: "neutral", text: "Withdrawn", icon: <XCircle size={12} aria-hidden /> },
};

export function AssistanceStatusBadge({ status, overdue }: { status: AssistanceRequest["status"]; overdue?: boolean }) {
  const s = STATUS[status];
  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={s.tone} icon={s.icon}>{s.text}</Badge>
      {overdue && <Badge tone="danger" icon={<Clock size={12} aria-hidden />}>Overdue</Badge>}
    </span>
  );
}

/** The mandate a unit holds for a category (and region) in the proposed unit directory. */
export function useMandate(category: string | undefined, region: number | null | undefined) {
  const { data } = useApi<{ items: DirectoryEntry[] }>(category ? "/routing/directory" : null);
  return (unit: string): DirectoryEntry | null => {
    const rows = (data?.items ?? []).filter((d) => d.code === unit && d.category_code === category && (!d.own_region_only || d.region_id === region));
    return rows.find((d) => d.role === "PRIMARY") ?? rows[0] ?? null;
  };
}

export function MandateHint({ entry, unit }: { entry: DirectoryEntry | null; unit: string }) {
  if (!unit) return null;
  if (!entry) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn-ink" data-testid="mandate-hint">
        <HelpCircle size={14} className="mt-px shrink-0" aria-hidden />The unit directory records no mandate for {unit} on this category. It may return the case; say why it should take it.
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 rounded-lg bg-ok-soft px-3 py-2 text-xs text-ok-ink" data-testid="mandate-hint">
      <ShieldCheck size={14} className="mt-px shrink-0" aria-hidden />
      <span><b>{entry.role === "PRIMARY" ? "Primary mandate" : "Supporting mandate"}.</b> {entry.basis}{entry.approval_status === "PROPOSED" ? " (proposed directory)" : ""}</span>
    </p>
  );
}

const ACTION: Record<RoutingRecommendation["action"], { tone: string; icon: ReactNode }> = {
  KEEP: { tone: "border-ok/30 bg-ok-soft text-ok-ink", icon: <CheckCircle2 size={20} aria-hidden /> },
  TRANSFER: { tone: "border-warn/40 bg-warn-soft text-warn-ink", icon: <ArrowLeftRight size={20} aria-hidden /> },
  ASSIST: { tone: "border-coord/30 bg-coord-soft text-coord-ink", icon: <LifeBuoy size={20} aria-hidden /> },
};

function headline(r: RoutingRecommendation): { title: string; detail: string } {
  if (r.action === "TRANSFER") return { title: `Transfer to ${r.unit} recommended`, detail: `${r.unit_name} holds the mandate for this category. ${r.holder} would stay responsible until ${r.unit} accepts.` };
  if (r.action === "ASSIST") return { title: `Keep the case; ask ${r.unit} for assistance`, detail: `${r.holder} remains the owner. ${r.unit_name} can help within its own mandate.` };
  return { title: `${r.holder} is the right unit`, detail: "No transfer or assistance is indicated by the unit directory and case history." };
}

export type RoutingPreset = { unit: string; text: string; kind?: AssistanceKind };

/** The routing check, shown to the holding unit. Approving opens the transfer or assistance form, pre-filled. */
export function RoutingCard({ c, onTransfer, onAssist }: { c: CaseDetail; onTransfer: (p: RoutingPreset) => void; onAssist: (p: RoutingPreset) => void }) {
  const r = c.routing;
  const [why, setWhy] = useState(false);
  if (!r) return null;
  const h = headline(r);
  const a = ACTION[r.action];
  const top = r.reasons.find((x) => x.weight > 0)?.label ?? "";
  const pct = Math.round(r.confidence * 100);
  const assistPreset = (unit: string, regional: boolean): RoutingPreset => ({
    unit,
    kind: regional ? "VERIFICATION" : "INFORMATION",
    text: regional ? `Please verify the facts on site at the institution and share your findings for ${c.case_no}.` : `Please share any records or findings your unit holds that bear on ${c.case_no}.`,
  });
  return (
    <Card title="Routing check" description="Advice from the unit directory and this case's history. You decide; nothing moves on its own." actions={<Route size={18} className="text-muted" aria-hidden />}>
      <div className="flex flex-col gap-4" data-testid="routing-card">
        <div className={cx("flex items-start gap-3 rounded-xl border p-4", a.tone)}>
          <span className="mt-0.5 shrink-0">{a.icon}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold" data-testid="routing-headline">{h.title}</p>
            <p className="mt-0.5 text-sm opacity-90">{h.detail}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-2" title="How clearly this unit stands out from the alternatives (relative, not a legal certainty)">
                <span className="h-1.5 w-20 rounded-full bg-white/60" aria-hidden><span className="block h-1.5 rounded-full bg-current" style={{ width: `${Math.max(6, pct)}%` }} /></span>
                <span className="tabular">Confidence {pct}%</span>
              </span>
              {r.ambiguous && <Badge tone="warn" icon={<HelpCircle size={12} aria-hidden />}>Ambiguous jurisdiction — check before acting</Badge>}
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Why {r.unit}</p>
          <EvidenceList reasons={r.reasons} />
        </div>

        {r.coordinating.length > 0 && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Network size={14} aria-hidden />Already coordinating:
            {r.coordinating.map((x) => <Link key={x.coordination} href={`/coordination/${x.coordination}`} className="font-medium text-action-ink hover:underline">{x.unit} · {x.coordination}</Link>)}
          </p>
        )}

        {(c.can_transfer || c.can_request_assistance) && (
          <div className="flex flex-wrap gap-2">
            {r.action === "TRANSFER" && c.can_transfer && (
              <Button onClick={() => onTransfer({ unit: r.unit, text: `Routing check: ${top}.` })} icon={<ArrowLeftRight size={15} aria-hidden />}>Approve transfer to {r.unit}</Button>
            )}
            {r.action === "ASSIST" && c.can_request_assistance && (
              <Button onClick={() => onAssist(assistPreset(r.unit, r.unit_type === "REGIONAL_OFFICE"))} icon={<LifeBuoy size={15} aria-hidden />}>Request assistance from {r.unit}</Button>
            )}
            {r.action === "TRANSFER" && c.can_request_assistance && (
              <Button variant="secondary" onClick={() => onAssist(assistPreset(r.unit, false))}>Keep it and ask {r.unit} to assist</Button>
            )}
            <Button variant="ghost" onClick={() => setWhy((v) => !v)} aria-expanded={why}>{why ? "Hide alternatives" : "Alternatives"}</Button>
          </div>
        )}

        {why && (
          <ul className="flex flex-col divide-y divide-rule rounded-lg border border-rule" aria-label="Alternative units">
            {r.action === "TRANSFER" && r.holder_reasons.length > 0 && (
              <li className="px-3.5 py-3 text-sm">
                <p className="font-semibold">Keep with {r.holder}</p>
                <div className="mt-1.5"><EvidenceList reasons={r.holder_reasons} compact /></div>
              </li>
            )}
            {r.alternatives.filter((x) => x.unit !== r.holder).map((x) => (
              <li key={x.unit} className="flex flex-wrap items-start justify-between gap-3 px-3.5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">{x.unit} <span className="font-normal text-muted">· {x.unit_name}</span>{x.mandate && <Badge className="ml-2" tone={x.mandate === "PRIMARY" ? "ok" : "info"}>{x.mandate === "PRIMARY" ? "Primary mandate" : "Supports"}</Badge>}</p>
                  <div className="mt-1.5"><EvidenceList reasons={x.reasons} compact /></div>
                </div>
                <div className="flex gap-1.5">
                  {c.can_transfer && <Button size="sm" variant="secondary" onClick={() => onTransfer({ unit: x.unit, text: "" })}>Transfer</Button>}
                  {c.can_request_assistance && <Button size="sm" variant="secondary" onClick={() => onAssist({ unit: x.unit, text: "" })}>Ask to assist</Button>}
                </div>
              </li>
            ))}
            {r.alternatives.filter((x) => x.unit !== r.holder).length === 0 && <li className="px-3.5 py-3 text-sm text-muted">No other unit scores on this case.</li>}
          </ul>
        )}
        <p className="text-xs text-muted">{r.note} Model {r.model}.</p>
      </div>
    </Card>
  );
}

/** Ask another unit for input or a task; the holding unit keeps custody. */
export function AssistanceDialog({ c, open, preset, onClose, onDone }:
  { c: CaseDetail; open: boolean; preset: RoutingPreset | null; onClose: () => void; onDone: (msg: string) => void }) {
  const { data: meta } = useApi<Meta>(open ? "/meta" : null);
  const mandate = useMandate(open ? c.category.code : undefined, c.region_id);
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting, isDirty } } = useForm<AssistanceForm>({
    resolver: zodResolver(assistanceSchema),
    defaultValues: { to_unit: preset?.unit ?? "", kind: preset?.kind ?? "INFORMATION", request: preset?.text ?? "", due_on: "" },
  });
  useUnsavedChanges(`assist-${c.case_no}`, open && isDirty);
  const unit = useWatch({ control, name: "to_unit" });
  const close = () => { reset(); setError(null); onClose(); };
  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      const out = await api<AssistanceRequest>(`/cases/${c.case_no}/assistance`, {
        json: { ...v, due_on: v.due_on || undefined, followed_recommendation: !!preset && preset.unit === v.to_unit && c.routing?.unit === v.to_unit },
      });
      reset();
      onDone(`${out.code} sent to ${out.to_unit}. ${c.holding_unit.code} keeps the case; reply due ${fmtDate(out.due_on)}.`);
    } catch (e) {
      setError(e);
    }
  });
  return (
    <Modal open={open} onClose={close} title="Request assistance"
      description={`${c.holding_unit.code} stays the owner of ${c.case_no}. The other unit can read the case only while the request is open, and must acknowledge it within 2 working days.`}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button type="submit" form="assist-form" busy={isSubmitting} icon={<Send size={15} aria-hidden />}>Send request</Button></>}>
      <form id="assist-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="as-unit" label="Unit to ask" required error={errors.to_unit?.message}>
            <select {...register("to_unit")} {...fieldA11y("as-unit", errors.to_unit?.message)} className={inputCls}>
              <option value="">Choose a unit</option>
              {meta?.units.filter((u) => u.code !== c.holding_unit.code).map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}
            </select>
          </Field>
          <Field id="as-kind" label="What you need" required>
            <select {...register("kind")} id="as-kind" className={inputCls}>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
        <MandateHint entry={unit ? mandate(unit) : null} unit={unit} />
        <Field id="as-request" label="Request" required error={errors.request?.message} hint="The other unit reads this first. Be specific about the question or task.">
          <textarea {...register("request")} {...fieldA11y("as-request", errors.request?.message, true)} className={cx(inputCls, "min-h-24")} />
        </Field>
        <Field id="as-due" label="Reply needed by" hint="Leave empty for 5 working days. Overdue requests are escalated to both unit heads.">
          <input {...register("due_on")} id="as-due" type="date" className={cx(inputCls, "sm:w-52")} />
        </Field>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

type ReplyMode = "accept" | "decline" | "complete" | "cancel";
const REPLY: Record<ReplyMode, { title: string; button: string; field?: string; hint?: string; variant: "primary" | "danger" | "secondary" }> = {
  accept: { title: "Accept this request?", button: "Accept and start", variant: "primary" },
  decline: { title: "Decline this request", button: "Decline", field: "Reason", hint: "The requesting unit sees this. Suggest a better-placed unit if there is one.", variant: "danger" },
  complete: { title: "Complete this request", button: "Send response", field: "Response", hint: "What was done or found. Attach any report on the case's Documents tab first.", variant: "primary" },
  cancel: { title: "Withdraw this request", button: "Withdraw", field: "Reason", hint: "The other unit is told the request is withdrawn.", variant: "danger" },
};

export function AssistanceReplyDialog({ req, mode, onClose, onDone }: { req: AssistanceRequest; mode: ReplyMode; onClose: () => void; onDone: (msg: string) => void }) {
  const { data: meta } = useApi<Meta>(mode === "decline" ? "/meta" : null);
  const [error, setError] = useState<unknown>(null);
  const cfg = REPLY[mode];
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<AssistanceReplyForm>({
    resolver: mode === "accept" ? undefined : zodResolver(assistanceReplySchema), defaultValues: { text: "", suggested_unit: "" },
  });
  const submit = handleSubmit(async (v) => {
    setError(null);
    const body = mode === "accept" ? {} : mode === "complete" ? { response: v.text } : mode === "decline" ? { reason: v.text, suggested_unit: v.suggested_unit || null } : { reason: v.text };
    try {
      const out = await api<AssistanceRequest>(`/assistance/${req.id}/${mode}`, { json: body, headers: { "if-match": String(req.row_version) } });
      onDone(mode === "accept" ? `${out.code} accepted. You can read ${out.case_no} until you complete it.`
        : mode === "complete" ? `${out.code} completed. ${out.from_unit} has your response.`
          : mode === "decline" ? `${out.code} declined. ${out.from_unit} keeps the case and sees your reason.`
            : `${out.code} withdrawn.`);
    } catch (e) {
      setError(e);
    }
  });
  return (
    <Modal open onClose={onClose} size="sm" title={cfg.title} description={`${req.code} · ${req.kind_label} · ${req.from_unit} → ${req.to_unit} · ${req.case_no}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="ar-form" busy={isSubmitting} variant={cfg.variant}>{cfg.button}</Button></>}>
      <form id="ar-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <blockquote className="rounded-lg bg-surface-2 px-3 py-2 text-sm">“{req.request}”</blockquote>
        {mode === "accept" && <p className="text-sm text-muted">You become the assignee. {req.from_unit} keeps the case; reply by {fmtDate(req.due_on)}.</p>}
        {cfg.field && (
          <Field id="ar-text" label={cfg.field} required error={errors.text?.message} hint={cfg.hint}>
            <textarea {...register("text")} {...fieldA11y("ar-text", errors.text?.message, true)} className={cx(inputCls, "min-h-24")} />
          </Field>
        )}
        {mode === "decline" && (
          <Field id="ar-unit" label="Better-placed unit (optional)">
            <select {...register("suggested_unit")} id="ar-unit" className={inputCls}>
              <option value="">No suggestion</option>
              {meta?.units.filter((u) => u.code !== req.to_unit && u.code !== req.from_unit).map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}
            </select>
          </Field>
        )}
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

/** One assistance request with the actions the caller may take on it. Used in the case workspace and the inbox. */
export function AssistanceItem({ a, onReply, showCase }: { a: AssistanceRequest; onReply: (a: AssistanceRequest, m: ReplyMode) => void; showCase?: boolean }) {
  return (
    <li className="grid gap-3 px-5 py-4 xl:grid-cols-[minmax(0,1fr)_200px_auto] xl:items-start" data-testid="assistance-row">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-mono font-semibold">{a.code}</span>
          <span className="font-semibold">{a.from_unit} → {a.to_unit}</span>
          <span className="text-muted">· {a.kind_label}</span>
          {a.followed_recommendation && <Badge tone="info" icon={<Route size={12} aria-hidden />}>From routing check</Badge>}
        </p>
        {showCase && (
          <p className="mt-0.5 truncate text-xs text-muted">
            <Link href={`/cases/${a.case_no}`} className="font-mono font-medium text-action-ink hover:underline">{a.case_no}</Link> · {a.institution?.name ?? "Institution unconfirmed"} · {a.category}
          </p>
        )}
        <p className="mt-1.5 whitespace-pre-wrap text-sm">“{a.request}”</p>
        {a.response && (
          <p className={cx("mt-2 whitespace-pre-wrap rounded-lg px-3 py-2 text-sm", a.status === "COMPLETED" ? "bg-ok-soft text-ok-ink" : "bg-surface-2")}>
            <span className="font-semibold">{a.status === "COMPLETED" ? `${a.to_unit} response` : a.status === "DECLINED" ? `${a.to_unit} declined` : "Withdrawn"}:</span> {a.response}
            {a.suggested_unit && <span className="block text-xs">Suggests asking {a.suggested_unit} instead.</span>}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <AssistanceStatusBadge status={a.status} overdue={a.overdue} />
        <span className="text-muted">Due {fmtDate(a.due_on)}</span>
        <span className="text-muted">By {a.requested_by} · {fmtDateTime(a.requested_at)}</span>
        {a.assignee && <span className="text-muted">Assignee: {a.assignee}</span>}
      </div>
      <div className="flex flex-wrap gap-2 xl:justify-end">
        {a.can_respond && a.status === "SENT" && <Button size="sm" onClick={() => onReply(a, "accept")} icon={<CheckCircle2 size={14} aria-hidden />}>Accept</Button>}
        {a.can_respond && <Button size="sm" variant={a.status === "ACCEPTED" ? "primary" : "secondary"} onClick={() => onReply(a, "complete")}>Complete</Button>}
        {a.can_respond && <Button size="sm" variant="ghost" onClick={() => onReply(a, "decline")}>Decline</Button>}
        {a.can_cancel && <Button size="sm" variant="ghost" onClick={() => onReply(a, "cancel")}>Withdraw</Button>}
      </div>
    </li>
  );
}

/** Assistance requests on this case, both directions, with a shortcut to ask another unit. */
export function AssistancePanel({ c, onAsk, onChanged }: { c: CaseDetail; onAsk: () => void; onChanged: (msg: string) => void }) {
  const [reply, setReply] = useState<{ a: AssistanceRequest; mode: ReplyMode } | null>(null);
  const open = c.assistance.filter((a) => a.status === "SENT" || a.status === "ACCEPTED").length;
  return (
    <Card title="Assistance from other units" description="The holding unit keeps the case; another unit gives input or performs a task."
      actions={c.can_request_assistance ? <Button size="sm" variant="secondary" onClick={onAsk} icon={<LifeBuoy size={14} aria-hidden />}>Request assistance</Button> : open ? <Badge tone="info">{open} open</Badge> : undefined}
      padded={c.assistance.length === 0}>
      {c.assistance.length === 0
        ? <EmptyState compact title="No assistance requested on this case." icon={<LifeBuoy size={18} />} />
        : <ul className="divide-y divide-rule" data-testid="assistance-list">{c.assistance.map((a) => <AssistanceItem key={a.id} a={a} onReply={(x, mode) => setReply({ a: x, mode })} />)}</ul>}
      {reply && <AssistanceReplyDialog req={reply.a} mode={reply.mode} onClose={() => setReply(null)} onDone={(msg) => { setReply(null); onChanged(msg); }} />}
    </Card>
  );
}
