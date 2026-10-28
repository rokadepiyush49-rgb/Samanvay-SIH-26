"use client";

import {
  ArrowLeftRight, Building2, CalendarClock, CheckCircle2, ClipboardList, FileText, GitMerge, History, LifeBuoy, Lock, MessageSquarePlus,
  MessagesSquare, Network, ShieldAlert, Sparkles, Upload, UserRound,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useRef, useState, type ReactNode } from "react";
import { CaseAssistant } from "@/components/case-assistant";
import { ActionDialog, NoteDialog, RevealDialog, TransferDecisionDialog, TransferDialog } from "@/components/case-dialogs";
import { CaseMessages } from "@/components/case-messages";
import { CaseTimeline, EventLine } from "@/components/case-timeline";
import { GuardDialog } from "@/components/conflict-guard";
import { Require } from "@/components/require";
import { AssistanceDialog, AssistancePanel, RoutingCard, type RoutingPreset } from "@/components/routing";
import { TaskPanel } from "@/components/tasks";
import { CaseFlags, CoordinationStatusBadge, EvidenceList, OverlapTypeBadge, StatusBadge } from "@/components/status";
import { useToast } from "@/components/toast";
import {
  Badge, Button, Card, EmptyState, ErrorNote, ErrorState, PageHeader, PageSkeleton, TabPanel, Tabs, cx,
} from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";
import { bytes, CHANNEL_LABEL, fmtDate, fmtDateTime, label } from "@/lib/format";
import { can } from "@/lib/permissions";
import { nextStep } from "@/lib/priority";
import { useSession } from "@/lib/session";
import type { AllowedAction, CaseDetail, CaseThread } from "@/lib/types";

const TABS = ["overview", "timeline", "documents", "links", "messages", "assistant"] as const;
type Tab = (typeof TABS)[number];
const TIMER_LABEL: Record<string, string> = {
  SLA_REMINDER: "Reminder", SLA_INTERIM: "Interim reply due", SLA_BREACH: "Overdue from", SLA_ESCALATION: "Escalation",
  JOINT_DUE: "Joint action due", TRANSFER_REMINDER: "Transfer reminder", TRANSFER_ESCALATION: "Transfer escalation",
  ASSIST_REMINDER: "Assistance reminder", ASSIST_OVERDUE: "Assistance overdue from", TASK_DUE: "Task reminder", TASK_OVERDUE: "Task overdue from",
};

function Fact({ icon, label: l, children, sub }: { icon: ReactNode; label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-muted">{l}</dt>
        <dd className="truncate text-sm font-semibold">{children}</dd>
        {sub && <dd className="text-xs text-muted">{sub}</dd>}
      </div>
    </div>
  );
}

/** Ownership, status, deadline and next action stay at the top of every tab. */
function CaseSummaryHeader({ c }: { c: CaseDetail }) {
  const step = nextStep(c);
  return (
    <Card padded={false}>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge bucket={c.bucket} label={c.status_label} />
          <CaseFlags c={c} />
          {c.language === "hi" && <Badge tone="info">हिन्दी</Badge>}
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact icon={<UserRound size={16} />} label="Current custodian" sub={`since ${fmtDate(c.holder_since)}`}>
            <span data-testid="case-holder">{c.holding_unit.code}</span> · {c.holding_officer?.name ?? "Unassigned"}
          </Fact>
          <Fact icon={<Building2 size={16} />} label="Institution"
            sub={c.institution ? <><span className="font-mono">{c.institution.permanent_id}</span>{c.institution.city ? ` · ${c.institution.city}` : ""}{c.institution_weight ? ` · match ${c.institution_weight.toFixed(2)}` : ""}</> : "awaiting confirmation"}>
            {c.institution ? <Link className="hover:underline" href={`/institutions/${c.institution.permanent_id}`}>{c.institution.name}</Link> : (c.institution_raw ?? "Not identified")}
          </Fact>
          <Fact icon={<CalendarClock size={16} />} label="Expected disposal"
            sub={c.overdue ? <span className="font-semibold text-danger">Overdue</span> : c.working_days_left !== null ? `${c.working_days_left} working days left` : c.sla_policy ? `${c.sla_policy.code} v${c.sla_policy.version}` : undefined}>
            {fmtDate(c.expected_disposal)}
          </Fact>
          {c.next_task ? (
            <Fact icon={<ClipboardList size={16} />} label="Next action"
              sub={<span className={cx(c.next_task.overdue && "font-semibold text-danger")}>{c.next_task.owner_unit}{c.next_task.due_on ? ` · ${c.next_task.overdue ? "overdue since" : "by"} ${fmtDate(c.next_task.due_on)}` : ""}</span>}>
              <span title={c.next_task.title} data-testid="next-task">{c.next_task.title}</span>
            </Fact>
          ) : (
            <Fact icon={<ClipboardList size={16} />} label="Next action" sub={c.next_action_due ? `by ${fmtDate(c.next_action_due)}` : step?.suggested ? "suggested from case state" : undefined}>
              <span className={cx(step?.suggested && "font-medium italic text-muted")} title={step?.text}>{step?.text ?? "None recorded"}</span>
            </Fact>
          )}
        </dl>
      </div>
    </Card>
  );
}

function ActionBar({ c, onAction, onGuard, onTransfer, onAssist, onNote, onUpload }:
  { c: CaseDetail; onAction: (a: AllowedAction) => void; onGuard: (a: AllowedAction) => void; onTransfer: () => void; onAssist: () => void; onNote: () => void; onUpload: () => void }) {
  const { me } = useSession();
  const holder = c.holding_unit.code === me.unit.code;
  const canNote = holder && c.tier === "full";
  const canUpload = c.tier === "full" && can(me, "cases.create");
  if (c.allowed_actions.length === 0 && !c.can_transfer && !c.can_request_assistance && !canNote && !canUpload) {
    return <p className="flex items-center gap-2 text-sm text-muted"><Lock size={14} aria-hidden />You can view this case. Only {c.holding_unit.code} records actions on it.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Case actions">
        {c.allowed_actions.map((a) => (
          <Button key={a.action} variant={a.consequential ? "navy" : "secondary"} onClick={() => (a.consequential ? onGuard(a) : onAction(a))}
            icon={a.consequential ? <ShieldAlert size={15} aria-hidden /> : undefined} title={a.consequential ? "Consequential action: runs the Action Conflict Guard first" : undefined}>
            {a.label}
          </Button>
        ))}
        {c.can_transfer && <Button variant="secondary" onClick={onTransfer} icon={<ArrowLeftRight size={15} aria-hidden />}>Transfer</Button>}
        {c.can_request_assistance && <Button variant="secondary" onClick={onAssist} icon={<LifeBuoy size={15} aria-hidden />}>Request assistance</Button>}
        {canNote && <Button variant="secondary" onClick={onNote} icon={<MessageSquarePlus size={15} aria-hidden />}>Add note / interim reply</Button>}
        {canUpload && <Button variant="secondary" onClick={onUpload} icon={<Upload size={15} aria-hidden />}>Upload document</Button>}
      </div>
      {c.allowed_actions.some((a) => a.consequential) && (
        <p className="flex items-center gap-1.5 text-xs text-muted"><ShieldAlert size={13} aria-hidden />Actions marked with the shield run the Action Conflict Guard before they are recorded. Closure always needs an officer’s decision; nothing closes automatically.</p>
      )}
    </div>
  );
}

function Alerts({ c, onDecide, run }: { c: CaseDetail; onDecide: (m: "accept" | "return") => void; run: (fn: () => Promise<unknown>, msg: string) => void }) {
  const { me } = useSession();
  const holder = c.holding_unit.code === me.unit.code;
  const open = c.coordination.filter((x) => x.status !== "DECIDED");
  return (
    <>
      {c.coordination_required && (
        <div className="flex flex-col gap-3 rounded-xl border border-coord/30 bg-coord-soft p-4 text-coord-ink sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="coordination-banner">
          <div className="flex items-start gap-3">
            <Network size={20} className="mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">{c.phrase}</p>
              <p className="text-sm">{open.map((x) => `${x.other_unit} holds ${x.other_case}`).join(" · ")}. Decide jointly before a consequential action.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">{open.map((x) => <Link key={x.code} href={`/coordination/${x.code}`} className="inline-flex h-9 items-center rounded-lg bg-coord px-3.5 text-sm font-semibold text-white hover:opacity-90">Review {x.code}</Link>)}</div>
        </div>
      )}
      {c.pending_transfer && (
        <div className="flex flex-col gap-3 rounded-xl border border-warn/30 bg-warn-soft p-4 text-warn-ink sm:flex-row sm:items-center sm:justify-between" data-testid="transfer-panel">
          <div className="flex items-start gap-3">
            <ArrowLeftRight size={20} className="mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">Transfer {c.pending_transfer.from_unit} → {c.pending_transfer.to_unit} is awaiting acceptance</p>
              <p className="text-sm">Custody stays with <b>{c.pending_transfer.from_unit}</b> until {c.pending_transfer.to_unit} accepts. Proposed {fmtDateTime(c.pending_transfer.proposed_at)}{c.pending_transfer.reason ? ` · “${c.pending_transfer.reason}”` : ""}</p>
            </div>
          </div>
          {c.pending_transfer.can_decide && (
            <div className="flex gap-2">
              <Button onClick={() => onDecide("accept")} icon={<CheckCircle2 size={15} aria-hidden />}>Accept</Button>
              <Button variant="secondary" onClick={() => onDecide("return")}>Return</Button>
            </div>
          )}
        </div>
      )}
      {c.tier === "full" && c.resolution_status !== "RESOLVED" && holder && (c.institution_candidates?.length ?? 0) > 0 && (
        <Card title="Confirm the institution" description="The resolver was not confident enough to decide alone. Overlap matching runs once you confirm. Sibling campuses are never merged automatically.">
          <ul className="grid gap-2 md:grid-cols-3">
            {c.institution_candidates!.map((x) => (
              <li key={x.institution_id}>
                <button className="flex h-full w-full flex-col gap-2 rounded-lg border border-rule p-3 text-left hover:border-action"
                  onClick={() => run(() => api(`/cases/${c.case_no}/institution`, { json: { institution_id: x.institution_id }, headers: { "if-match": String(c.row_version) } }), `Institution confirmed: ${x.name}.`)}>
                  <span className="flex justify-between gap-2"><span className="text-sm font-semibold">{x.name}</span><span className="text-xs font-semibold tabular">{x.probability.toFixed(2)}</span></span>
                  <span className="text-xs text-muted">{x.city} · <span className="font-mono">{x.permanent_id}</span></span>
                  <EvidenceList reasons={x.reasons} compact />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function Overview({ c, onReveal, onTransfer, onAssist, onChanged }:
  { c: CaseDetail; onReveal: () => void; onTransfer: (p: RoutingPreset) => void; onAssist: (p: RoutingPreset | null) => void; onChanged: (msg: string) => void }) {
  const custody = c.timeline.filter((e) => e.type.startsWith("TRANSFER") || e.type === "ESCALATED" || e.type === "ASSIGNED").sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-5">
        {(c.tasks.length > 0 || c.can_add_task) && <TaskPanel c={c} onChanged={onChanged} />}
        <RoutingCard c={c} onTransfer={onTransfer} onAssist={onAssist} />
        {(c.assistance.length > 0 || c.can_request_assistance) && <AssistancePanel c={c} onAsk={() => onAssist(null)} onChanged={onChanged} />}
        {c.tier === "metadata" ? (
          <Card>
            <div className="flex items-start gap-3" data-testid="metadata-only">
              <Lock size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
              <div><p className="font-semibold">Metadata view</p><p className="text-sm text-muted">{c.access_note ?? "Complaint text and documents are visible to the holding unit and coordinating units only."}</p></div>
            </div>
          </Card>
        ) : c.content && (
          <Card title="Complaint as received" description={`${CHANNEL_LABEL[c.channel] ?? c.channel} · received ${fmtDate(c.received_on)}`}>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed" lang={c.language}>{c.content.body}</p>
            {c.content.complainant_on_file && (
              <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-3 text-xs text-muted">
                <Lock size={13} aria-hidden />Complainant identity is encrypted and masked.
                <button className="font-medium text-action hover:underline" onClick={onReveal}>Reveal with a recorded reason</button>
              </p>
            )}
          </Card>
        )}
        <Card title="Transfer and escalation history" padded={custody.length > 0}>
          {custody.length === 0 ? <p className="px-5 pb-5 pt-0 text-sm text-muted">No transfers, assignments or escalations yet.</p> : <ol className="flex flex-col">{custody.map((e) => <EventLine key={e.id} e={e} />)}</ol>}
        </Card>
      </div>
      <aside className="flex flex-col gap-5">
        {c.coordination.length > 0 && (
          <Card title="Coordination" padded={false}>
            <ul className="divide-y divide-rule">
              {c.coordination.map((x) => (
                <li key={x.code}>
                  <Link href={`/coordination/${x.code}`} className="flex items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-surface-2/70">
                    <span><span className="font-mono font-semibold">{x.code}</span><span className="block text-xs text-muted">with {x.other_unit} · {x.other_case}</span></span>
                    <CoordinationStatusBadge status={x.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card title="Deadlines">
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Received</dt><dd className="tabular">{fmtDate(c.received_on)}</dd>
            <dt className="text-muted">Expected disposal</dt><dd className="tabular font-semibold">{fmtDate(c.expected_disposal)}</dd>
            {c.upcoming?.map((t) => <Fragment key={t.kind + t.due_at}><dt className="text-muted">{TIMER_LABEL[t.kind] ?? label(t.kind)}</dt><dd className="tabular">{fmtDate(t.due_at)}</dd></Fragment>)}
          </dl>
          {c.sla_policy && <p className="mt-3 border-t border-rule pt-3 text-xs text-muted">Policy {c.sla_policy.name} ({c.sla_policy.code} v{c.sla_policy.version}): {c.sla_policy.target_days} {c.sla_policy.day_basis === "WORKING" ? "working" : "calendar"} days · {label(c.sla_policy.approval_status)}</p>}
        </Card>
        <Card title="Case details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Category</dt><dd>{c.category.name}</dd>
            <dt className="text-muted">Channel</dt><dd>{CHANNEL_LABEL[c.channel] ?? c.channel}</dd>
            <dt className="text-muted">Source ref.</dt><dd className="font-mono text-xs">{c.source_ref ?? "—"}</dd>
            <dt className="text-muted">CPGRAMS no.</dt><dd className="font-mono text-xs">{c.cpgrams_no ?? "—"}</dd>
            <dt className="text-muted">Sensitivity</dt><dd>{label(c.sensitivity)}</dd>
            <dt className="text-muted">Your access</dt><dd>{c.tier === "full" ? "Full content" : "Metadata only"}</dd>
          </dl>
        </Card>
      </aside>
    </div>
  );
}

function Documents({ c, onUpload }: { c: CaseDetail; onUpload: () => void }) {
  const { me } = useSession();
  if (!c.documents) return <EmptyState title="Documents are restricted" icon={<Lock size={20} />}>Only the holding unit and coordinating units can see this case&apos;s documents.</EmptyState>;
  if (c.documents.length === 0) {
    return <EmptyState title="No documents yet" icon={<FileText size={20} />} action={can(me, "cases.create") && <Button variant="secondary" onClick={onUpload} icon={<Upload size={15} aria-hidden />}>Upload document</Button>}>
      Letters, replies and evidence (PDF, images, Office files; 25 MB max). Every file is scanned and hashed.
    </EmptyState>;
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {c.documents.map((d) => (
        <li key={d.id} className="flex items-start gap-3 rounded-xl border border-rule bg-surface p-4 shadow-card">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-action-soft text-action" aria-hidden><FileText size={18} /></span>
          <div className="min-w-0 text-sm">
            {d.scan_status === "CLEAN" ? <a className="font-semibold text-action-ink hover:underline" href={`/api/v1/documents/${d.id}`}>{d.filename}</a> : <span className="font-semibold">{d.filename}</span>}
            <p className="text-xs text-muted">{bytes(d.size_bytes)} · {d.uploaded_by} · {fmtDateTime(d.uploaded_at)}</p>
            <p className="mt-1.5"><Badge tone={d.scan_status === "CLEAN" ? "ok" : "danger"}>{d.scan_status === "CLEAN" ? "Scanned clean" : label(d.scan_status)}</Badge></p>
            <p className="mt-1.5 truncate font-mono text-[11px] text-muted" title={d.sha256}>SHA-256 {d.sha256}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Links({ c }: { c: CaseDetail }) {
  if (c.links.length === 0) return <EmptyState title="No linked cases" icon={<GitMerge size={20} />}>The overlap engine found no related case for this institution.</EmptyState>;
  return (
    <ul className="flex flex-col gap-4">
      {c.links.map((l) => (
        <li key={l.id}>
          <Card padded={false}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
              <p className="text-sm"><Link className="font-mono font-semibold text-action-ink hover:underline" href={`/cases/${l.other_case}`}>{l.other_case}</Link> · <b>{l.other_unit}</b> · {l.other_status_label ?? "status hidden"}</p>
              <span className="flex flex-wrap items-center gap-2">
                <OverlapTypeBadge type={l.type} prob={l.probability} />
                <Badge tone={l.status === "CONFIRMED" ? "ok" : l.status === "REJECTED" ? "neutral" : "warn"}>{l.status === "PROPOSED" ? "Proposed — needs review" : label(l.status)}</Badge>
              </span>
            </div>
            <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Why these cases were matched</p>
                <EvidenceList reasons={l.reasons} />
              </div>
              <div className="rounded-lg bg-surface-2/70 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Coordination</p>
                {l.coordination_code ? (
                  <>
                    <Link className="mt-1 block font-mono font-semibold text-action-ink hover:underline" href={`/coordination/${l.coordination_code}`}>{l.coordination_code}</Link>
                    <p className="mt-1"><CoordinationStatusBadge status={l.coordination_status ?? "OPEN"} /></p>
                    {l.decision && <p className="mt-1 text-xs">{label(l.decision)}{l.lead_unit ? ` · ${l.lead_unit} leads` : ""}</p>}
                  </>
                ) : <p className="mt-1 text-xs text-muted">No coordination card. Similarity is evidence for review, not proof the cases are the same.</p>}
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Workspace() {
  const { caseNo } = useParams<{ caseNo: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const toast = useToast();
  const { data: c, error, mutate, isLoading } = useApi<CaseDetail>(`/cases/${caseNo}`);
  const { data: thread } = useApi<CaseThread>(c?.tier === "full" ? `/cases/${caseNo}/messages` : null, { refreshInterval: 30000 });
  const tab = ((TABS as readonly string[]).includes(sp.get("tab") ?? "") ? sp.get("tab") : "overview") as Tab;
  const [action, setAction] = useState<AllowedAction | null>(null);
  const [guardAction, setGuardAction] = useState<AllowedAction | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [assist, setAssist] = useState(false);
  const [preset, setPreset] = useState<RoutingPreset | null>(null);
  const [decide, setDecide] = useState<"accept" | "return" | null>(null);
  const [note, setNote] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [opError, setOpError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (isLoading) return <PageSkeleton label="Loading case" />;
  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return <EmptyState title="Case not found" icon={<Lock size={20} />}>It does not exist, or it is in a restricted category you are not cleared for.</EmptyState>;
    }
    return <ErrorState error={error} onRetry={() => mutate()} />;
  }
  if (!c) return null;

  const setTab = (t: Tab) => router.replace(`${pathname}${t === "overview" ? "" : `?tab=${t}`}`, { scroll: false });
  const done = (msg?: string) => {
    setAction(null); setGuardAction(null); setTransfer(false); setAssist(false); setPreset(null); setNote(false); setDecide(null);
    if (msg) toast({ kind: "success", title: msg });
    void mutate();
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
  const upload = (file: File) => {
    const form = new FormData();
    form.append("file", file);
    void run(() => api(`/cases/${c.case_no}/documents`, { form }), `${file.name} uploaded, scanned and hashed.`);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader crumbs={[{ label: "All Cases", href: "/cases" }, { label: c.case_no }]}
        title={<span className="flex flex-wrap items-baseline gap-x-3"><span className="font-mono text-[1.35rem]" data-testid="case-no">{c.case_no}</span><span className="text-base font-medium text-muted">{c.content?.subject ?? c.category.name}</span></span>}
        meta={<><span>{CHANNEL_LABEL[c.channel] ?? c.channel}</span>{c.source_ref && <span className="font-mono">{c.source_ref}</span>}<span>Received {fmtDate(c.received_on)}</span><span>Last action {label(c.last_action)}</span></>} />

      <CaseSummaryHeader c={c} />
      <ActionBar c={c} onAction={setAction} onGuard={setGuardAction} onTransfer={() => { setPreset(null); setTransfer(true); }}
        onAssist={() => { setPreset(null); setAssist(true); }} onNote={() => setNote(true)} onUpload={() => fileRef.current?.click()} />
      <input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      <ErrorNote error={opError} />
      <Alerts c={c} onDecide={setDecide} run={run} />

      <div className="flex flex-col gap-5">
        <Tabs idBase="case" label="Case sections" value={tab} onChange={setTab} items={[
          { value: "overview", label: "Overview", icon: <ClipboardList size={15} aria-hidden /> },
          { value: "timeline", label: "Timeline", count: c.timeline.length, icon: <History size={15} aria-hidden /> },
          { value: "documents", label: "Documents", count: c.documents?.length, icon: <FileText size={15} aria-hidden /> },
          { value: "links", label: "Linked cases", count: c.links.length, icon: <GitMerge size={15} aria-hidden /> },
          { value: "messages", label: "Messages", count: thread?.items.length, icon: <MessagesSquare size={15} aria-hidden /> },
          { value: "assistant", label: "AI assistant", icon: <Sparkles size={15} aria-hidden /> },
        ]} />
        <TabPanel idBase="case" value={tab}>
          {tab === "overview" && (
            <Overview c={c} onReveal={() => setReveal(true)} onChanged={(msg) => done(msg)}
              onTransfer={(p) => { setPreset(p); setTransfer(true); }} onAssist={(p) => { setPreset(p); setAssist(true); }} />
          )}
          {tab === "timeline" && <Card><CaseTimeline events={c.timeline} /></Card>}
          {tab === "documents" && <Documents c={c} onUpload={() => fileRef.current?.click()} />}
          {tab === "links" && <Links c={c} />}
          {tab === "messages" && <CaseMessages caseNo={c.case_no} tier={c.tier} holder={c.holding_unit.code} onChanged={() => void mutate()} />}
          {tab === "assistant" && <CaseAssistant caseNo={c.case_no} tier={c.tier} />}
        </TabPanel>
      </div>

      <ActionDialog key={`a-${action?.action}`} caseNo={c.case_no} version={c.row_version} action={action} onClose={() => setAction(null)} onDone={() => done(`${action?.label} recorded.`)} />
      <GuardDialog key={`g-${guardAction?.action}-${c.row_version}`} caseNo={c.case_no} action={guardAction} onClose={() => { setGuardAction(null); void mutate(); }} onDone={(m) => done(m)} />
      <TransferDialog key={`tr-${preset?.unit ?? ""}-${transfer}`} caseNo={c.case_no} version={c.row_version} holder={c.holding_unit.code} open={transfer}
        preset={preset} category={c.category.code} region={c.region_id} recommendedUnit={c.routing?.action === "TRANSFER" ? c.routing.unit : undefined}
        onClose={() => { setTransfer(false); setPreset(null); }} onDone={(to) => done(`Transfer to ${to} proposed. Custody stays with ${c.holding_unit.code} until ${to} accepts.`)} />
      <AssistanceDialog key={`as-${preset?.unit ?? ""}-${assist}`} c={c} open={assist} preset={preset}
        onClose={() => { setAssist(false); setPreset(null); }} onDone={(msg) => done(msg)} />
      {c.pending_transfer && decide && (
        <TransferDecisionDialog mode={decide} transfer={{ ...c.pending_transfer, case_no: c.case_no }} onClose={() => setDecide(null)} onDone={(m) => done(m)} />
      )}
      <NoteDialog caseNo={c.case_no} open={note} onClose={() => setNote(false)} onDone={() => done("Saved to the case file.")} />
      <RevealDialog caseNo={c.case_no} open={reveal} onClose={() => setReveal(false)} />
    </div>
  );
}

export default function CaseWorkspacePage() {
  return <Require cap="cases.view"><Suspense fallback={<PageSkeleton />}><Workspace /></Suspense></Require>;
}
