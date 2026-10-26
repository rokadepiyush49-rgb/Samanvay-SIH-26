"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Copy, GitMerge, Lock, MessageSquare, Send, TrendingUp, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ApprovalSteps, RISK, outstanding } from "@/components/coordination";
import { Require } from "@/components/require";
import { CoordinationStatusBadge, EvidenceList, OverlapTypeBadge, OVERLAP_TYPE_NAME } from "@/components/status";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, ErrorNote, ErrorState, Field, Modal, PageHeader, PageSkeleton, TabPanel, Tabs, cx, fieldA11y, inputCls } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { fmtDate, fmtDateTime, label } from "@/lib/format";
import { decisionSchema, type DecisionForm } from "@/lib/schemas";
import { useSession, useUnsavedChanges } from "@/lib/session";
import type { CoordSide, CoordinationRoom } from "@/lib/types";

const OPTIONS = [
  { value: "DUPLICATE", title: "Same matter / duplicate", detail: "The same complaint. The other case follows the lead case.", icon: <Copy size={18} aria-hidden /> },
  { value: "RELATED", title: "Related — needs a lead unit", detail: "Different complaints about the same matter. One unit leads; the other coordinates.", icon: <GitMerge size={18} aria-hidden /> },
  { value: "NOT_RELATED", title: "Not related — dismiss alert", detail: "Reason required. This pair is silenced; cases continue separately.", icon: <XCircle size={18} aria-hidden /> },
] as const;

function SideCard({ s, tag }: { s: CoordSide; tag: string }) {
  return (
    <Card padded={false} className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-3.5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Case {tag} · {s.unit}</p>
          <Link href={`/cases/${s.case_no}`} className="font-mono text-base font-semibold text-action-ink hover:underline">{s.case_no}</Link>
        </div>
        <Badge tone={s.status === "DISPOSED" ? "ok" : "info"}>{s.status_label}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-4 text-sm">
        <div><dt className="text-xs text-muted">Holding unit · officer</dt><dd className="font-medium">{s.unit} · {s.officer ?? "Unassigned"}</dd></div>
        <div><dt className="text-xs text-muted">Category</dt><dd className="font-medium">{s.category}</dd></div>
        <div><dt className="text-xs text-muted">Received</dt><dd className="tabular">{fmtDate(s.received_on)}</dd></div>
        <div><dt className="text-xs text-muted">Custodian since</dt><dd className="tabular">{fmtDate(s.holder_since)}</dd></div>
      </dl>
      <div className="mt-auto border-t border-rule px-5 py-4">
        {s.body ? (
          <>
            {s.subject && <p className="text-sm font-semibold">{s.subject}</p>}
            <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-sm text-ink/90">{s.body}</p>
          </>
        ) : <p className="flex items-center gap-2 text-xs text-muted"><Lock size={13} aria-hidden />Complaint text is visible to participating units only.</p>}
      </div>
    </Card>
  );
}

function DecisionPanel({ c, onChanged }: { c: CoordinationRoom; onChanged: (msg: string) => void }) {
  const { me } = useSession();
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [escalate, setEscalate] = useState(false);
  const { register, handleSubmit, setValue, control, reset, formState: { errors, isSubmitting, isDirty } } = useForm<DecisionForm>({
    resolver: zodResolver(decisionSchema),
    defaultValues: { decision: "RELATED", lead_unit: "", joint_next_action: "", joint_due: "", remarks: "" },
  });
  useUnsavedChanges(`decision-${c.code}`, isDirty);
  const decision = useWatch({ control, name: "decision" });
  const lead = useWatch({ control, name: "lead_unit" });
  const p = c.proposal;
  const mineProposed = p?.by_unit === me.unit.code && c.a.unit !== c.b.unit;

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await api(`/coordination/${c.code}/decision`, {
        json: { decision: v.decision, lead_unit: v.decision === "NOT_RELATED" ? null : v.lead_unit, joint_next_action: v.joint_next_action || null, joint_due: v.joint_due || null, remarks: v.remarks || null },
        headers: { "if-match": String(c.row_version) },
      });
      reset(v);
      onChanged(c.status === "ESCALATED" ? "Decision recorded." : "Proposal sent. The other unit must confirm before it takes effect.");
    } catch (e) {
      setError(e);
    }
  });
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/coordination/${c.code}/confirm`, { method: "POST", headers: { "if-match": String(c.row_version) } });
      setConfirming(false);
      onChanged("Decision confirmed. Both case histories now record it.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (c.status === "DECIDED") {
    return (
      <Card title="Decision" description="Recorded in both case histories and the audit chain.">
        <div className="flex items-start gap-3 rounded-lg bg-ok-soft p-4 text-ok-ink" data-testid="decision-final">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold">{label(c.decision)}{c.lead_unit ? ` · ${c.lead_unit} is the lead unit` : ""}</p>
            {p?.joint_next_action && <p className="mt-0.5">Joint action: {p.joint_next_action}{p.joint_due ? ` by ${fmtDate(p.joint_due)}` : ""}</p>}
            {p?.remarks && <p className="mt-0.5">“{p.remarks}” — {p.by} ({p.by_unit})</p>}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Decision" description={outstanding(c)}>
      <div className="flex flex-col gap-4">
        {p && c.status === "AWAITING_CONFIRMATION" && (
          <div className="rounded-lg border border-action/30 bg-action-soft/60 p-4 text-sm" data-testid="proposal">
            <p className="font-semibold">{p.by_unit} proposed: {label(p.decision)}{p.lead_unit ? `, ${p.lead_unit} leads` : ""}</p>
            {p.joint_next_action && <p className="mt-0.5">Joint action: {p.joint_next_action}{p.joint_due ? ` by ${fmtDate(p.joint_due)}` : ""}</p>}
            {p.remarks && <p className="mt-0.5 text-muted">“{p.remarks}” — {p.by}</p>}
            {c.awaiting_me && <div className="mt-3"><Button onClick={() => setConfirming(true)} icon={<CheckCircle2 size={15} aria-hidden />}>Confirm this decision</Button></div>}
            {mineProposed && <p className="mt-2 text-xs text-muted">Your unit proposed this. It takes effect when the other unit confirms.</p>}
          </div>
        )}

        {c.can_decide ? (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">{p ? "Or propose a different decision" : "Your decision"}</legend>
              <div className="grid gap-2" role="radiogroup" aria-label="Decision">
                {OPTIONS.map((o) => (
                  <label key={o.value} className={cx("flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors",
                    decision === o.value ? "border-action bg-action-soft/50 ring-1 ring-action" : "border-rule hover:border-rule-strong")}>
                    <input type="radio" value={o.value} {...register("decision")} className="mt-1 h-4 w-4 accent-[var(--action)]" />
                    <span className="mt-0.5 text-muted">{o.icon}</span>
                    <span><span className="block font-semibold">{o.title}</span><span className="text-xs text-muted">{o.detail}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            {decision !== "NOT_RELATED" && (
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">Lead unit <span className="text-danger" aria-hidden>*</span></legend>
                <div className="flex flex-wrap gap-2">
                  {c.units.map((u) => (
                    <button key={u} type="button" aria-pressed={lead === u} onClick={() => setValue("lead_unit", u, { shouldValidate: true, shouldDirty: true })}
                      className={cx("rounded-lg border px-4 py-2 text-sm font-semibold", lead === u ? "border-navy bg-navy text-white" : "border-rule-strong hover:bg-surface-2")}>{u}</button>
                  ))}
                </div>
                {errors.lead_unit && <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-danger" role="alert"><AlertTriangle size={12} aria-hidden />{errors.lead_unit.message}</p>}
              </fieldset>
            )}
            {decision !== "NOT_RELATED" && (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                <Field id="d-joint" label="Joint next action"><input {...register("joint_next_action")} id="d-joint" className={inputCls} placeholder="e.g. Consolidated reply to complainant" /></Field>
                <Field id="d-due" label="Joint deadline"><input {...register("joint_due")} id="d-due" type="date" className={inputCls} /></Field>
              </div>
            )}
            <Field id="d-remarks" label={decision === "NOT_RELATED" ? "Reason the cases are not related" : "Rationale"} required={decision === "NOT_RELATED"} error={errors.remarks?.message}
              hint="Recorded with your name, unit and time. The other unit sees it.">
              <textarea {...register("remarks")} {...fieldA11y("d-remarks", errors.remarks?.message, true)} className={cx(inputCls, "min-h-20")} />
            </Field>
            <ErrorNote error={error} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setEscalate(true)} icon={<TrendingUp size={15} aria-hidden />}>Escalate</Button>
              <Button type="submit" busy={isSubmitting}>{c.status === "ESCALATED" ? "Record decision" : "Send proposal for confirmation"}</Button>
            </div>
            <p className="text-xs text-muted">Cases are never merged automatically. A duplicate decision makes the later case follow the lead case; both stay in the ledger.</p>
          </form>
        ) : !c.awaiting_me && (
          <p className="text-sm text-muted">You can follow this coordination. The two holding units (or, after escalation, the nodal officer) decide it.</p>
        )}
        {!c.can_decide && <ErrorNote error={error} />}
      </div>

      <Modal open={confirming} onClose={() => setConfirming(false)} size="sm" title="Confirm the decision?"
        description={p ? `${label(p.decision)}${p.lead_unit ? `, ${p.lead_unit} leads` : ""}. This is recorded on both cases and in the audit chain.` : undefined}
        footer={<><Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button><Button busy={busy} onClick={confirm}>Confirm decision</Button></>} />
      <EscalateDialog code={c.code} open={escalate} onClose={() => setEscalate(false)} onDone={() => { setEscalate(false); onChanged("Escalated to the nodal officer."); }} />
    </Card>
  );
}

function EscalateDialog({ code, open, onClose, onDone }: { code: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const short = reason.trim().length < 5;
  const go = async () => {
    setBusy(true);
    try {
      await api(`/coordination/${code}/escalate`, { json: { reason } });
      setReason("");
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Escalate this coordination" description="The nodal officer and Competent Authority are notified and can decide it."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" busy={busy} disabled={short} onClick={go}>Escalate</Button></>}>
      <Field id="esc-reason" label="Reason for escalation" required hint="At least 5 characters.">
        <textarea {...fieldA11y("esc-reason", undefined, true)} className={cx(inputCls, "min-h-20")} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="mt-3"><ErrorNote error={error} /></div>
    </Modal>
  );
}

function Discussion({ c, onSent }: { c: CoordinationRoom; onSent: () => void }) {
  const { me } = useSession();
  const [msg, setMsg] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(`msg-${c.code}`, msg.trim().length > 0);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msg.trim()) return;
    setBusy(true);
    try {
      await api(`/coordination/${c.code}/messages`, { json: { body: msg } });
      setMsg("");
      onSent();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Coordination room" description={`Visible to ${c.units.join(" and ")} and oversight roles only.`}>
      <ul className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto">
        {c.messages.length === 0 && <li className="text-sm text-muted">No messages yet. Use this to agree facts before deciding.</li>}
        {c.messages.map((m) => {
          const own = m.unit === me.unit.code;
          return (
            <li key={m.id} className={cx("max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm", own ? "self-end bg-action-soft text-action-ink" : "self-start bg-surface-2")}>
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className="mt-1 text-[11px] opacity-75">{m.author} · {m.unit} · {fmtDateTime(m.at)}</p>
            </li>
          );
        })}
      </ul>
      {(c.participant || c.can_decide) && (
        <form className="mt-4 flex gap-2 border-t border-rule pt-4" onSubmit={send}>
          <label htmlFor="room-msg" className="sr-only">Message to the other unit</label>
          <input id="room-msg" className={inputCls} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Write to the other unit" />
          <Button type="submit" busy={busy} icon={<Send size={15} aria-hidden />}>Send</Button>
        </form>
      )}
      <div className="mt-2"><ErrorNote error={error} /></div>
    </Card>
  );
}

function Room() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const toast = useToast();
  const { t } = useSession();
  const tab = sp.get("tab") === "discussion" ? "discussion" : "review";
  const { data: c, error, mutate, isLoading } = useApi<CoordinationRoom>(`/coordination/${code}`, { refreshInterval: 20000 });
  if (isLoading) return <PageSkeleton label="Loading coordination" />;
  if (error || !c) return <ErrorState error={error} onRetry={() => mutate()} />;
  const changed = (msg: string) => { toast({ kind: "success", title: msg }); void mutate(); };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader crumbs={[{ label: t("nav.coordination"), href: "/coordination" }, { label: c.code }]}
        title={c.institution.name ?? "Institution unconfirmed"}
        description={c.status !== "DECIDED" ? c.phrase : undefined}
        meta={<><span className="font-mono">{c.code}</span>{c.institution.permanent_id && <span className="font-mono">{c.institution.permanent_id}</span>}{c.institution.city && <span>{c.institution.city}</span>}
          {c.status !== "DECIDED" && <span className={cx(c.working_days_left <= 1 && "font-semibold text-danger")}>Decide by {fmtDate(c.decide_by)} ({c.working_days_left} working days)</span>}</>}
        actions={<><OverlapTypeBadge type={c.type} prob={c.probability} /><CoordinationStatusBadge status={c.status} /></>} />

      <ApprovalSteps c={c} />

      <Tabs idBase="room" label="Coordination sections" value={tab} onChange={(v) => router.replace(`${pathname}${v === "review" ? "" : "?tab=discussion"}`, { scroll: false })}
        items={[{ value: "review", label: "Review & decide" }, { value: "discussion", label: "Discussion", count: c.messages.length, icon: <MessageSquare size={15} aria-hidden /> }]} />
      <TabPanel idBase="room" value={tab}>
        {tab === "review" ? (
          <div className="flex flex-col gap-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <SideCard s={c.a} tag="A" />
              <SideCard s={c.b} tag="B" />
            </div>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
              <Card title="Why these cases were matched" description="Each feature the overlap engine used, with its weight (log-odds). Features marked − counted against a match.">
                <div className="flex flex-col gap-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-surface-2/70 p-3 text-sm">
                      <p className="text-xs text-muted">Overlap type</p>
                      <p className="font-semibold">{OVERLAP_TYPE_NAME[c.type] ?? c.type_label}</p>
                    </div>
                    <div className="rounded-lg bg-surface-2/70 p-3 text-sm">
                      <p className="text-xs text-muted">Model score (same-matter probability)</p>
                      <p className="font-semibold tabular">{c.probability >= 0.01 ? c.probability.toFixed(2) : "Not applicable — rule-triggered"}</p>
                    </div>
                  </div>
                  <EvidenceList reasons={c.reasons} />
                  <div className="flex items-start gap-3 rounded-lg border border-coord/30 bg-coord-soft p-3.5 text-sm text-coord-ink">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
                    <div><p className="font-semibold">Possible conflicting or duplicated action</p><p className="mt-0.5">{RISK[c.type] ?? RISK.R}</p></div>
                  </div>
                </div>
              </Card>
              <DecisionPanel c={c} onChanged={changed} />
            </div>
          </div>
        ) : <Discussion c={c} onSent={() => void mutate()} />}
      </TabPanel>
    </div>
  );
}

export default function CoordinationRoomPage() {
  return <Require cap="coordination.view"><Suspense fallback={<PageSkeleton />}><Room /></Suspense></Require>;
}
