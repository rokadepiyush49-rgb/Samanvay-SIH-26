"use client";

import { FileSearch, Search, ShieldAlert, ShieldCheck, Stamp } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useState } from "react";
import { AccessReview } from "@/components/access-review";
import { Require } from "@/components/require";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, PageHeader, Table, TableSkeleton, TabPanel, Tabs, cx, inputCls, rowClick } from "@/components/ui";
import { api, qs, useApi } from "@/lib/api";
import { fmtDateTime, label } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import type { AuditEvents, AuditVerify } from "@/lib/types";

type Event = AuditEvents["items"][number];
const ENTITY_TYPES = ["", "case", "coordination", "transfer", "guard_check", "institution", "user", "report", "import"];

/** Events record actions that were carried out; refusals and lockouts are recorded as their own event types. */
function outcome(e: Event): { text: string; tone: "ok" | "warn" | "danger" | "neutral" } {
  if (/locked|failed|rejected|returned/.test(e.action)) return { text: "Refused / reversed", tone: "danger" };
  if (e.payload.choice === "PROCEED_AND_NOTIFY" || e.payload.guard_choice === "PROCEED_AND_NOTIFY") return { text: "Proceeded past overlap", tone: "warn" };
  if (e.action.startsWith("guard.") && e.payload.result) return { text: label(String(e.payload.result)), tone: "neutral" };
  return { text: "Recorded", tone: "ok" };
}

function Detail({ e, onClose }: { e: Event | null; onClose: () => void }) {
  if (!e) return null;
  const before = e.payload.before as Record<string, unknown> | undefined;
  const after = e.payload.after as Record<string, unknown> | undefined;
  const rest = Object.entries(e.payload).filter(([k]) => k !== "before" && k !== "after");
  return (
    <Modal open onClose={onClose} size="lg" title={`Audit entry #${e.seq}`} description={`${e.action} · ${fmtDateTime(e.at)}`}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted">Actor</dt><dd>{e.actor ?? "System"}{e.unit ? ` (${e.unit})` : ""}</dd>
        <dt className="text-muted">Resource</dt><dd className="font-mono text-xs">{e.entity_type ?? "—"} · {e.entity_id ?? "—"}</dd>
        <dt className="text-muted">Entry hash</dt><dd className="break-all font-mono text-[11px]">{e.hash}</dd>
      </dl>
      {(before || after) && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">Change</p>
          <Table caption="Before and after" head={["Field", "Before", "After"]} minWidth={400}>
            {[...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].map((k) => (
              <tr key={k}><td className="font-medium">{label(k)}</td><td className="font-mono text-xs">{JSON.stringify(before?.[k] ?? null)}</td><td className="font-mono text-xs">{JSON.stringify(after?.[k] ?? null)}</td></tr>
            ))}
          </Table>
        </div>
      )}
      {rest.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">Recorded details</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-surface-2 p-3 text-xs">
            {rest.map(([k, v]) => <Fragment key={k}><dt className="text-muted">{label(k)}</dt><dd className="break-all font-mono">{typeof v === "string" ? v : JSON.stringify(v)}</dd></Fragment>)}
          </dl>
        </div>
      )}
      <p className="mt-4 text-xs text-muted">Audit entries hold identifiers and decisions, not complaint text or complainant identity.</p>
    </Modal>
  );
}

function EventLog() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const applied = { entity_type: sp.get("entity_type") ?? "", entity_id: sp.get("entity_id") ?? "", action: sp.get("action") ?? "" };
  const [form, setForm] = useState(applied);
  const [before, setBefore] = useState<number[]>([]);
  const cursor = before[before.length - 1];
  const { data, error, isLoading, mutate } = useApi<AuditEvents>(`/audit${qs({ ...applied, limit: 50, before: cursor })}`, { keepPreviousData: true });
  const [open, setOpen] = useState<Event | null>(null);
  const minSeq = data?.items.length ? data.items[data.items.length - 1].seq : null;
  return (
    <div className="flex flex-col gap-4">
      <form role="search" className="grid gap-3 rounded-xl border border-rule bg-surface p-3 shadow-card sm:grid-cols-[180px_1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => { e.preventDefault(); setBefore([]); router.replace(`${pathname}${qs({ ...form, tab: "events" })}`, { scroll: false }); }}>
        <Field id="au-type" label="Resource type">
          <select id="au-type" className={inputCls} value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })}>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t ? label(t) : "Any"}</option>)}
          </select>
        </Field>
        <Field id="au-id" label="Resource ID (exact)"><input id="au-id" className={cx(inputCls, "font-mono")} value={form.entity_id} onChange={(e) => setForm({ ...form, entity_id: e.target.value })} placeholder="UUID or code" /></Field>
        <Field id="au-act" label="Event type starts with"><input id="au-act" className={cx(inputCls, "font-mono")} value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} placeholder="case., guard., auth.login" /></Field>
        <Button type="submit" icon={<Search size={15} aria-hidden />}>Search</Button>
      </form>
      <ErrorNote error={error} onRetry={() => mutate()} />
      {isLoading && !data && <TableSkeleton rows={8} />}
      {data && (data.items.length === 0 ? <EmptyState title="No audit entries match" icon={<FileSearch size={20} />} /> : (
        <>
          <Table caption="Audit events" head={["#", "When", "Actor", "Event", "Resource", "Outcome", "Hash"]} minWidth={860}>
            {data.items.map((e) => {
              const o = outcome(e);
              return (
                <tr key={e.seq} onClick={rowClick(() => setOpen(e))} className="cursor-pointer hover:bg-action-soft/40">
                  <td className="tabular text-muted"><button type="button" onClick={() => setOpen(e)} className="hover:underline" aria-label={`Open audit entry ${e.seq}`}>{e.seq}</button></td>
                  <td className="whitespace-nowrap tabular">{fmtDateTime(e.at)}</td>
                  <td className="text-xs">{e.actor ?? "System"}{e.unit ? <span className="text-muted"> · {e.unit}</span> : null}</td>
                  <td><span className={cx("font-mono text-xs font-semibold", e.action.startsWith("guard") ? "text-coord" : e.action.startsWith("auth") ? "text-muted" : "text-ink")}>{e.action}</span></td>
                  <td className="max-w-[16rem] truncate font-mono text-[11px]" title={e.entity_id ?? undefined}>{e.entity_type ? `${e.entity_type} · ` : ""}{e.entity_id}</td>
                  <td><Badge tone={o.tone}>{o.text}</Badge></td>
                  <td className="font-mono text-[11px] text-muted">{e.hash.slice(0, 10)}…</td>
                </tr>
              );
            })}
          </Table>
          <div className="flex items-center justify-between gap-2 text-sm">
            <Button size="sm" variant="secondary" disabled={before.length === 0} onClick={() => setBefore((b) => b.slice(0, -1))}>Newer</Button>
            <span className="text-xs text-muted">Entries {data.items[0].seq.toLocaleString("en-IN")}–{minSeq?.toLocaleString("en-IN")} of {data.head_seq.toLocaleString("en-IN")}</span>
            <Button size="sm" variant="secondary" disabled={!minSeq || minSeq <= 1 || data.items.length < 50} onClick={() => minSeq && setBefore((b) => [...b, minSeq])}>Older</Button>
          </div>
        </>
      ))}
      <Detail e={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Integrity() {
  const { me } = useSession();
  const toast = useToast();
  const { data, mutate } = useApi<AuditEvents>("/audit?limit=1");
  const [verify, setVerify] = useState<AuditVerify | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try { await fn(); void mutate(); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  return (
    <div className="flex flex-col gap-4">
      <Card title="Chain integrity" description="Every entry stores SHA-256(previous hash ‖ entry). Signed Merkle checkpoints (Ed25519 key held outside the database) detect a rewrite of the whole chain.">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted">Latest entry</dt><dd className="font-semibold tabular">#{data?.head_seq?.toLocaleString("en-IN") ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">Last signed checkpoint</dt><dd className="font-semibold">{data?.last_checkpoint ? `#${data.last_checkpoint.upto_seq.toLocaleString("en-IN")} · ${fmtDateTime(data.last_checkpoint.at)}` : "None yet"}</dd></div>
          <div><dt className="text-xs text-muted">Signing key</dt><dd className="font-mono text-xs">{data?.last_checkpoint?.key_id ?? "—"}</dd></div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button busy={busy === "verify"} icon={<ShieldCheck size={15} aria-hidden />} onClick={() => run("verify", async () => setVerify(await api<AuditVerify>("/audit/verify", { method: "POST" })))}>Verify the whole chain</Button>
          {can(me, "audit.checkpoint") && (
            <Button variant="secondary" busy={busy === "cp"} icon={<Stamp size={15} aria-hidden />} onClick={() => run("cp", async () => { await api("/audit/checkpoint", { method: "POST" }); toast({ kind: "success", title: "Checkpoint signed." }); })}>Sign a checkpoint</Button>
          )}
        </div>
        <div className="mt-3"><ErrorNote error={error} /></div>
      </Card>
      {verify && (
        <div role="status" className={cx("flex items-start gap-3 rounded-xl border p-4", verify.ok ? "border-ok/30 bg-ok-soft text-ok-ink" : "border-danger/30 bg-danger-soft text-danger-ink")} data-testid="verify-result">
          {verify.ok ? <ShieldCheck size={24} className="shrink-0" aria-hidden /> : <ShieldAlert size={24} className="shrink-0" aria-hidden />}
          <div>
            <p className="text-lg font-semibold">{verify.ok ? "Chain intact" : `Chain broken at entry ${verify.first_broken_seq}`}</p>
            <p className="text-sm">{verify.ok ? `${verify.entries.toLocaleString("en-IN")} entries and ${verify.checkpoints} signed checkpoints verified.` : verify.problem}</p>
            <p className="mt-1 font-mono text-[11px] opacity-80">Public key {verify.public_key_id}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Audit() {
  const { me, t } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tab = (["events", "integrity", "access"].includes(sp.get("tab") ?? "") ? sp.get("tab") : "events") as "events" | "integrity" | "access";
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("nav.audit")} crumbs={[{ label: t("group.system") }, { label: t("nav.audit") }]}
        description="Read-only, tamper-evident record of who did what, when. Insert-only at the database level; nobody can edit or delete an entry." />
      <Tabs idBase="audit" label="Audit sections" value={tab} onChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })} items={[
        { value: "events", label: "Event log" }, { value: "integrity", label: "Integrity verification" },
        ...(me.roles.includes("AUDITOR") || me.roles.includes("SYS_ADMIN") ? [{ value: "access" as const, label: "Access review" }] : []),
      ]} />
      <TabPanel idBase="audit" value={tab}>
        {tab === "events" && <EventLog />}
        {tab === "integrity" && <Integrity />}
        {tab === "access" && <AccessReview />}
      </TabPanel>
    </div>
  );
}

export default function AuditPage() {
  return <Require cap="audit.view"><Suspense fallback={<TableSkeleton />}><Audit /></Suspense></Require>;
}
