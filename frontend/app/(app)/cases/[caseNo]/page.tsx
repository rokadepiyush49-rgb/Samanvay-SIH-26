"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { ActionDialog, GuardDialog, NoteDialog, TransferDialog, type AllowedAction } from "@/components/case-dialogs";
import { CaseFlags, ReasonList } from "@/components/cases";
import { IconDoc, IconLock, IconTransfer, IconUpload } from "@/components/icons";
import { FadeIn } from "@/components/motion";
import { Badge, Button, Card, Empty, ErrorNote, Field, Modal, Spinner, StatusChip, Tabs, TypeBadge, inputCls, cx } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";
import { CHANNEL_LABEL, fmtDate, fmtDateTime, label } from "@/lib/format";
import { hasRole, useSession } from "@/lib/session";
import type { CaseRow, Reason } from "@/lib/types";

type Detail = CaseRow & {
  row_version: number;
  tier: "full" | "metadata";
  cpgrams_no: string | null;
  language: string;
  institution_weight: number | null;
  holder_since: string;
  timeline: { id: number; type: string; action: string | null; action_label: string | null; at: string; actor: string; actor_unit: string | null; from_status: string | null; to_status: string | null; from_unit: string | null; to_unit: string | null; remarks?: string | null; data: Record<string, unknown> }[];
  links: { id: string; type: string; type_label: string; probability: number; reasons: Reason[]; status: string; other_case: string; other_status_label: string | null; other_unit: string; coordination_code: string | null; coordination_status: string | null; decision: string | null; lead_unit: string | null }[];
  coordination: { code: string; status: string; decision: string | null; lead_unit: string | null; other_case: string; other_unit: string; type: string; probability: number }[];
  coordination_required: boolean;
  phrase: string;
  allowed_actions: AllowedAction[];
  can_transfer: boolean;
  pending_transfer: { id: string; reason: string | null; proposed_at: string; from_unit: string; to_unit: string; can_decide: boolean } | null;
  content: { subject: string; body: string; complainant_on_file: boolean } | null;
  documents: { id: string; filename: string; mime: string; size_bytes: number; sha256: string; scan_status: string; scan_detail: string; uploaded_at: string; uploaded_by: string }[] | null;
  upcoming?: { kind: string; due_at: string }[];
  institution_candidates?: { institution_id: string; permanent_id: string; name: string; city: string; probability: number; reasons: Reason[] }[];
  sla_policy?: { code: string; version: number; name: string; day_basis: string; target_days: number; approval_status: string } | null;
  access_note?: string;
};

const EVENT_LABEL: Record<string, string> = {
  RECEIVED: "Received", STATUS_CHANGED: "Status changed", ACTION: "Action", TRANSFER_PROPOSED: "Transfer proposed",
  TRANSFER_ACCEPTED: "Transfer accepted", TRANSFER_RETURNED: "Transfer returned", ASSIGNED: "Assigned",
  COORDINATION_OPENED: "Coordination opened", COORDINATION_DECIDED: "Coordination decided", ESCALATED: "Escalated",
  SLA_ASSIGNED: "Timeline set", INSTITUTION_RESOLVED: "Institution resolved", NOTE: "Internal note",
  INTERIM_REPLY_SENT: "Interim reply sent", NEXT_ACTION: "Next action set", DOCUMENT_ADDED: "Document added",
  DOCUMENT_REJECTED: "Document rejected",
};
const TIMER_LABEL: Record<string, string> = { SLA_REMINDER: "Reminder", SLA_INTERIM: "Interim reply due", SLA_BREACH: "Overdue from", SLA_ESCALATION: "Escalation", JOINT_DUE: "Joint action due", TRANSFER_REMINDER: "Transfer reminder", TRANSFER_ESCALATION: "Transfer escalation" };

export default function CaseWorkspace() {
  const { caseNo } = useParams<{ caseNo: string }>();
  const { me } = useSession();
  const { data: c, error, mutate, isLoading } = useApi<Detail>(`/cases/${caseNo}`);
  const [tab, setTab] = useState<"timeline" | "documents" | "links">("timeline");
  const [action, setAction] = useState<AllowedAction | null>(null);
  const [guardAction, setGuardAction] = useState<AllowedAction | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [note, setNote] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [opError, setOpError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (isLoading) return <Spinner />;
  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return notFound ? <Empty title="Case not found">It does not exist, or it is in a restricted category you are not cleared for.</Empty> : <ErrorNote error={error} onRetry={() => mutate()} />;
  }
  if (!c) return null;

  const done = (msg?: string) => {
    setAction(null); setGuardAction(null); setTransfer(false); setNote(false);
    if (msg) setFlash(msg);
    mutate();
  };
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setOpError(null);
    try {
      await fn();
      done(msg);
    } catch (e) {
      setOpError(e);
    }
  };
  const upload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    await run(() => api(`/cases/${c.case_no}/documents`, { form }), `${file.name} uploaded and scanned.`);
  };
  const holder = c.holding_unit.code === me?.unit.code;
  const openCards = c.coordination.filter((x) => x.status !== "DECIDED");

  return (
    <FadeIn className="flex flex-col gap-5">
      <section className="rounded-[2rem] bg-navy p-6 text-on-navy sm:p-8">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky">
          <span className="font-mono">{c.case_no}</span><span>·</span><span>{CHANNEL_LABEL[c.channel]}</span>
          {c.source_ref && <><span>·</span><span className="font-mono normal-case">{c.source_ref}</span></>}
          {c.language === "hi" && <Badge tone="info">हिन्दी</Badge>}
        </div>
        <h1 className="mt-2 max-w-4xl text-2xl font-extrabold leading-tight text-white sm:text-3xl">{c.content?.subject ?? c.category.name}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <StatusChip bucket={c.bucket} label={c.status_label} />
          <CaseFlags c={c} />
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-sky">Held by</dt><dd className="font-bold text-white">{c.holding_unit.code} · {c.holding_officer?.name ?? "Unassigned"}</dd><dd className="text-xs">since {fmtDate(c.holder_since)}</dd></div>
          <div><dt className="text-xs text-sky">Institution</dt><dd className="font-bold text-white">{c.institution ? <Link className="underline-offset-2 hover:underline" href={`/institutions/${c.institution.permanent_id}`}>{c.institution.name}</Link> : (c.institution_raw ?? "Unresolved")}</dd><dd className="text-xs">{c.institution ? `${c.institution.city} · ${c.institution.permanent_id}${c.institution_weight ? ` · match ${c.institution_weight.toFixed(2)}` : ""}` : "awaiting confirmation"}</dd></div>
          <div><dt className="text-xs text-sky">Expected disposal</dt><dd className="font-bold text-white">{fmtDate(c.expected_disposal)}</dd><dd className="text-xs">{c.overdue ? "overdue" : c.working_days_left !== null ? `${c.working_days_left} working days left` : ""}{c.sla_policy ? ` · ${c.sla_policy.code} v${c.sla_policy.version} (${c.sla_policy.approval_status.toLowerCase()})` : ""}</dd></div>
          <div><dt className="text-xs text-sky">Category · received</dt><dd className="font-bold text-white">{c.category.name}</dd><dd className="text-xs">{fmtDate(c.received_on)} · last action {label(c.last_action)}</dd></div>
        </dl>
      </section>

      {flash && <p role="status" className="rounded-2xl bg-mint px-4 py-3 text-sm font-semibold text-mint-ink">{flash}</p>}
      <ErrorNote error={opError} />

      {c.coordination_required && (
        <Card tone="pink" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-extrabold">{c.phrase}</p>
            <p className="text-sm">{openCards.map((x) => `${x.other_unit} holds ${x.other_case}`).join(" · ")}. Decide jointly before consequential action.</p>
          </div>
          <div className="flex flex-wrap gap-2">{openCards.map((x) => <Link key={x.code} href={`/coordination/${x.code}`} className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white">Open {x.code}</Link>)}</div>
        </Card>
      )}

      {c.pending_transfer && (
        <Card tone="yellow" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <IconTransfer className="mt-0.5" />
            <div>
              <p className="font-bold">Transfer {c.pending_transfer.from_unit} → {c.pending_transfer.to_unit} awaiting acceptance</p>
              <p className="text-sm">{c.pending_transfer.reason ?? ""} · proposed {fmtDateTime(c.pending_transfer.proposed_at)}. Custody stays with {c.pending_transfer.from_unit} until accepted.</p>
            </div>
          </div>
          {c.pending_transfer.can_decide && (
            <div className="flex gap-2">
              <Button onClick={() => run(() => api(`/transfers/${c.pending_transfer!.id}/accept`, { json: {} }), "Transfer accepted; the case is now on your desk.")}>Accept</Button>
              <Button variant="soft" onClick={() => {
                const remarks = window.prompt("Reason for returning the transfer");
                if (remarks) run(() => api(`/transfers/${c.pending_transfer!.id}/return`, { json: { remarks } }), "Transfer returned with reason.");
              }}>Return</Button>
            </div>
          )}
        </Card>
      )}

      {c.tier === "full" && c.resolution_status !== "RESOLVED" && holder && (c.institution_candidates?.length ?? 0) > 0 && (
        <Card tone="cream">
          <p className="font-bold">Confirm the institution</p>
          <p className="text-sm text-muted">The resolver was not confident enough to decide alone. Overlap matching runs once the institution is confirmed.</p>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {c.institution_candidates!.map((x) => (
              <button key={x.institution_id} className="rounded-2xl border border-rule bg-surface p-3 text-left hover:border-navy"
                onClick={() => run(() => api(`/cases/${c.case_no}/institution`, { json: { institution_id: x.institution_id }, headers: { "if-match": String(c.row_version) } }), "Institution confirmed.")}>
                <span className="flex justify-between gap-2"><span className="text-sm font-bold">{x.name}</span><span className="text-xs font-bold tabular">{x.probability.toFixed(2)}</span></span>
                <span className="text-xs text-muted">{x.city} · {x.permanent_id}</span>
                <span className="mt-2 block"><ReasonList reasons={x.reasons} compact /></span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          {(c.allowed_actions.length > 0 || c.can_transfer || (holder && c.tier === "full")) && (
            <div className="flex flex-wrap gap-2">
              {c.allowed_actions.map((a) => (
                <Button key={a.action} variant={a.consequential ? "primary" : "soft"} onClick={() => (a.consequential ? setGuardAction(a) : setAction(a))}>
                  {a.consequential && <span aria-hidden>⚑</span>}{a.label}
                </Button>
              ))}
              {c.can_transfer && <Button variant="soft" onClick={() => setTransfer(true)}><IconTransfer size={16} />Transfer</Button>}
              {holder && c.tier === "full" && <Button variant="soft" onClick={() => setNote(true)}>Add note / interim reply</Button>}
              {c.tier === "full" && hasRole(me, "CASE_OFFICER", "UNIT_HEAD", "INTAKE_OFFICER", "REGIONAL_OFFICER") && (
                <>
                  <Button variant="soft" onClick={() => fileRef.current?.click()}><IconUpload size={16} />Upload</Button>
                  <input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
                </>
              )}
            </div>
          )}
          {c.allowed_actions.some((a) => a.consequential) && <p className="-mt-2 text-xs text-muted">⚑ Consequential actions run the Action Conflict Guard first.</p>}

          {c.tier === "metadata" ? (
            <Card tone="cream" className="flex items-start gap-3">
              <IconLock className="mt-0.5 shrink-0" />
              <div><p className="font-bold">Metadata view</p><p className="text-sm text-muted">{c.access_note}</p></div>
            </Card>
          ) : c.content && (
            <Card>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Complaint (as received)</p>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed" lang={c.language}>{c.content.body}</p>
              {c.content.complainant_on_file && (
                <p className="mt-3 text-xs text-muted">Complainant identity is encrypted and masked. <button className="font-semibold underline" onClick={() => setReveal(true)}>Reveal with reason</button></p>
              )}
            </Card>
          )}

          <Tabs value={tab} onChange={setTab} items={[
            { value: "timeline", label: "Timeline", count: c.timeline.length },
            { value: "links", label: "Linked cases", count: c.links.length },
            { value: "documents", label: "Documents", count: c.documents?.length ?? 0 },
          ]} />

          {tab === "timeline" && (
            <ol className="relative flex flex-col gap-3 border-l-2 border-rule pl-5">
              {c.timeline.map((e) => (
                <li key={e.id} className="relative">
                  <span className={cx("absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-page", e.type.startsWith("COORDINATION") ? "bg-pink-ink" : e.type.startsWith("TRANSFER") ? "bg-yellow-ink" : e.type === "ACTION" ? "bg-navy" : "bg-sky-ink")} aria-hidden />
                  <div className="rounded-2xl border border-rule bg-surface p-3.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-bold">{e.type === "ACTION" ? e.action_label : EVENT_LABEL[e.type] ?? label(e.type)}
                        {e.to_status && e.from_status !== e.to_status && <span className="font-normal text-muted"> → {label(e.to_status)}</span>}
                        {e.to_unit && e.from_unit && <span className="font-normal text-muted"> · {e.from_unit} → {e.to_unit}</span>}
                      </p>
                      <p className="text-xs text-muted">{fmtDateTime(e.at)} · {e.actor}{e.actor_unit ? ` (${e.actor_unit})` : ""}</p>
                    </div>
                    {e.remarks && <p className="mt-1.5 text-sm">{e.remarks}</p>}
                    {"guard_result" in e.data && <p className="mt-1.5 text-xs"><Badge tone={e.data.guard_choice === "PROCEED_AND_NOTIFY" ? "warn" : "ok"}>Guard: {label(String(e.data.guard_result))} · {label(String(e.data.guard_choice))}</Badge>{e.data.guard_reason ? <span className="ml-2 text-muted">“{String(e.data.guard_reason)}”</span> : null}</p>}
                    {e.type === "COORDINATION_OPENED" && <p className="mt-1.5 text-xs font-semibold text-pink-ink">{String(e.data.phrase ?? "")} · {String(e.data.coordination ?? "")}</p>}
                    {e.type === "COORDINATION_DECIDED" && <p className="mt-1.5 text-xs">{label(String(e.data.decision))}{e.data.lead_unit ? `, ${e.data.lead_unit} leads` : ""}{e.data.joint_due ? ` · joint action by ${fmtDate(String(e.data.joint_due))}` : ""}</p>}
                    {e.type === "DOCUMENT_ADDED" && <p className="mt-1.5 font-mono text-[11px] text-muted">{String(e.data.filename)} · sha256 {String(e.data.sha256).slice(0, 16)}…</p>}
                    {e.type === "SLA_ASSIGNED" && <p className="mt-1.5 text-xs text-muted">Policy {String(e.data.policy)} v{String(e.data.version)} · due {fmtDate(String(e.data.due))}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {tab === "links" && (c.links.length === 0 ? <Empty title="No linked cases.">Overlap matching found no related case.</Empty> : (
            <ul className="flex flex-col gap-3">
              {c.links.map((l) => (
                <li key={l.id} className="rounded-3xl border border-rule bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm"><Link className="font-mono font-bold underline-offset-2 hover:underline" href={`/cases/${l.other_case}`}>{l.other_case}</Link> · <b>{l.other_unit}</b> · {l.other_status_label}</p>
                    <span className="flex items-center gap-2"><TypeBadge type={l.type} prob={l.probability} /><Badge tone={l.status === "CONFIRMED" ? "ok" : l.status === "REJECTED" ? "plain" : "warn"}>{label(l.status)}</Badge></span>
                  </div>
                  <div className="mt-3"><ReasonList reasons={l.reasons} /></div>
                  {l.coordination_code && <p className="mt-2 text-xs">Coordination <Link className="font-mono font-bold underline" href={`/coordination/${l.coordination_code}`}>{l.coordination_code}</Link> · {label(l.coordination_status)}{l.decision ? ` · ${label(l.decision)}` : ""}{l.lead_unit ? ` · ${l.lead_unit} leads` : ""}</p>}
                </li>
              ))}
            </ul>
          ))}

          {tab === "documents" && (!c.documents ? <Empty title="Documents are visible to the holding unit." /> : c.documents.length === 0 ? <Empty title="No documents yet.">Upload letters, replies or evidence (25 MB max; scanned and hashed).</Empty> : (
            <ul className="grid gap-3 md:grid-cols-2">
              {c.documents.map((d) => (
                <li key={d.id} className="flex items-start gap-3 rounded-3xl border border-rule bg-surface p-4">
                  <IconDoc className="mt-0.5 shrink-0 text-sky-ink" />
                  <div className="min-w-0 text-sm">
                    {d.scan_status === "CLEAN" ? <a className="font-bold underline-offset-2 hover:underline" href={`/api/v1/documents/${d.id}`}>{d.filename}</a> : <span className="font-bold">{d.filename}</span>}
                    <p className="text-xs text-muted">{(d.size_bytes / 1024).toFixed(0)} KB · {d.uploaded_by} · {fmtDateTime(d.uploaded_at)}</p>
                    <p className="mt-1"><Badge tone={d.scan_status === "CLEAN" ? "ok" : "danger"}>{label(d.scan_status)}</Badge></p>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted" title={d.sha256}>sha256 {d.sha256}</p>
                  </div>
                </li>
              ))}
            </ul>
          ))}
        </div>

        <aside className="flex flex-col gap-4">
          <Card>
            <h3 className="font-bold">Next steps</h3>
            <p className="mt-1 text-sm">{c.next_action ?? "No next action recorded."}{c.next_action_due ? ` · by ${fmtDate(c.next_action_due)}` : ""}</p>
            {(c.upcoming?.length ?? 0) > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                {c.upcoming!.map((t) => <li key={t.kind + t.due_at} className="flex justify-between gap-2"><span className="text-muted">{TIMER_LABEL[t.kind] ?? label(t.kind)}</span><span className="tabular">{fmtDate(t.due_at)}</span></li>)}
              </ul>
            )}
          </Card>
          {c.coordination.length > 0 && (
            <Card tone="cream">
              <h3 className="font-bold">Coordination</h3>
              <ul className="mt-3 flex flex-col gap-2">
                {c.coordination.map((x) => (
                  <li key={x.code}><Link href={`/coordination/${x.code}`} className="flex items-center justify-between rounded-2xl bg-surface px-3 py-2 text-sm hover:bg-surface-2">
                    <span><span className="font-mono font-bold">{x.code}</span><span className="block text-xs text-muted">with {x.other_unit} · {x.other_case}</span></span>
                    <Badge tone={x.status === "DECIDED" ? "ok" : x.status === "ESCALATED" ? "danger" : "warn"}>{label(x.status)}</Badge>
                  </Link></li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <h3 className="font-bold">References</h3>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">CPGRAMS</dt><dd className="font-mono text-xs">{c.cpgrams_no ?? "—"}</dd>
              <dt className="text-muted">Sensitivity</dt><dd>{label(c.sensitivity)}</dd>
              <dt className="text-muted">Your view</dt><dd>{c.tier === "full" ? "Full content" : "Metadata only"}</dd>
            </dl>
          </Card>
        </aside>
      </div>

      <ActionDialog key={`a-${action?.action}`} caseNo={c.case_no} version={c.row_version} action={action} onClose={() => setAction(null)} onDone={() => done(`${action?.label} recorded.`)} />
      <GuardDialog key={`g-${guardAction?.action}-${c.row_version}`} caseNo={c.case_no} action={guardAction} onClose={() => { setGuardAction(null); mutate(); }} onDone={(m) => done(m)} />
      <TransferDialog caseNo={c.case_no} version={c.row_version} holder={c.holding_unit.code} open={transfer} onClose={() => setTransfer(false)} onDone={() => done("Transfer proposed; awaiting acceptance.")} />
      <NoteDialog caseNo={c.case_no} open={note} onClose={() => setNote(false)} onDone={() => done("Saved to the case file.")} />
      <RevealDialog caseNo={c.case_no} open={reveal} onClose={() => setReveal(false)} />
    </FadeIn>
  );
}

function RevealDialog({ caseNo, open, onClose }: { caseNo: string; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [out, setOut] = useState<{ name: string | null; contact: string | null; notice: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const go = async () => {
    try {
      setOut(await api(`/cases/${caseNo}/complainant`, { json: { reason } }));
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Modal open={open} onClose={() => { setOut(null); setReason(""); onClose(); }} title="Reveal complainant identity">
      {out ? (
        <div className="flex flex-col gap-2 text-sm">
          <p><b>Name:</b> {out.name ?? "—"}</p><p><b>Contact:</b> {out.contact ?? "—"}</p>
          <p className="rounded-2xl bg-yellow px-3 py-2 text-yellow-ink">{out.notice}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">Every reveal is written to the audit chain with your reason.</p>
          <Field label="Reason" required><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <ErrorNote error={error} />
          <div className="flex justify-end"><Button disabled={reason.trim().length < 10} onClick={go}>Reveal</Button></div>
        </div>
      )}
    </Modal>
  );
}
