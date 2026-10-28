"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, GitMerge, History, Landmark, Link2, Lock, MapPin, Network, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { CaseGraph } from "@/components/case-graph";
import { CaseTable, REGISTER_COLUMNS } from "@/components/cases";
import { Require } from "@/components/require";
import { OverlapTypeBadge } from "@/components/status";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, EmptyState, ErrorNote, ErrorState, Field, KpiCard, PageHeader, PageSkeleton, TabPanel, Tabs, cx, fieldA11y, inputCls } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { fmtDate, label } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import type { CaseRow, Institution360 } from "@/lib/types";

type Tab = "overview" | "cases" | "graph" | "alerts" | "history";
const STATUS_COLOR: Record<string, string> = { pending: "var(--warn)", under_process: "var(--action)", disposed: "var(--ok)", rejected: "var(--muted)", transferred: "var(--coord)" };

/** One lane per unit, one mark per case on a shared time axis. Ring = open, filled dot = closed, dashed halo = undecided parallel action. */
function Constellation({ cases }: { cases: CaseRow[] }) {
  const [now] = useState(() => Date.now());
  if (cases.length === 0) return <EmptyState compact title="No cases to plot." />;
  const units = [...new Set(cases.map((c) => c.holding_unit.code))];
  const times = cases.map((c) => new Date(c.received_on).getTime());
  const lo = Math.min(...times) - 7 * 864e5;
  const hi = Math.max(now, ...times) + 7 * 864e5;
  const W = 900, lane = 44, left = 72, H = units.length * lane + 34;
  const x = (t: number) => left + ((t - lo) / (hi - lo)) * (W - left - 16);
  const months: number[] = [];
  const d = new Date(lo); d.setDate(1); d.setMonth(d.getMonth() + 1);
  while (d.getTime() < hi) { months.push(d.getTime()); d.setMonth(d.getMonth() + 1); }
  const step = Math.max(1, Math.ceil(months.length / 10));
  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[640px]" role="img" aria-label={`Timeline of ${cases.length} cases across ${units.length} units`}>
          {months.map((m, i) => (
            <g key={m}>
              <line x1={x(m)} x2={x(m)} y1={4} y2={H - 26} stroke="var(--rule)" />
              {i % step === 0 && <text x={x(m)} y={H - 10} fontSize="11" fill="var(--muted)" textAnchor="middle">{new Date(m).toLocaleString("en-IN", { month: "short", year: "2-digit" })}</text>}
            </g>
          ))}
          {units.map((u, i) => (
            <g key={u}>
              <text x={8} y={i * lane + 28} fontSize="12" fontWeight="600" fill="var(--ink)">{u}</text>
              <line x1={left} x2={W - 16} y1={i * lane + 24} y2={i * lane + 24} stroke="var(--rule-strong)" strokeDasharray="2 4" />
            </g>
          ))}
          {cases.map((c) => {
            const i = units.indexOf(c.holding_unit.code);
            const open = c.bucket !== "disposed" && c.bucket !== "rejected";
            const cx_ = x(new Date(c.received_on).getTime());
            const col = STATUS_COLOR[c.bucket] ?? "var(--muted)";
            return (
              <a key={c.id} href={`/cases/${c.case_no}`} aria-label={`${c.case_no}, ${c.holding_unit.code}, ${c.status_label}, received ${fmtDate(c.received_on)}`}>
                <title>{`${c.case_no} · ${c.category.name} · ${c.status_label} · received ${fmtDate(c.received_on)}`}</title>
                <circle cx={cx_} cy={i * lane + 24} r={open ? 7 : 5.5} fill={open ? "var(--surface)" : col} stroke={col} strokeWidth={open ? 2.5 : 0} />
                {c.overlaps.parallel_open > 0 && <circle cx={cx_} cy={i * lane + 24} r={12} fill="none" stroke="var(--coord)" strokeWidth={1.5} strokeDasharray="2 2" />}
              </a>
            );
          })}
        </svg>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
        <li className="flex items-center gap-1.5"><svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="5" fill="none" stroke="var(--action)" strokeWidth="2" /></svg>Open case</li>
        <li className="flex items-center gap-1.5"><svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="5" fill="var(--ok)" /></svg>Closed case</li>
        <li className="flex items-center gap-1.5"><svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="6" fill="none" stroke="var(--coord)" strokeDasharray="2 2" /></svg>Undecided parallel-action overlap</li>
        <li>Colour follows status: amber pending, blue under process, green disposed. Select a mark to open the case.</li>
      </ul>
    </div>
  );
}

const aliasSchema = z.object({ alias: z.string().trim().min(3, "An alias needs at least 3 characters.").max(300) });

function AddAlias({ pid, onDone }: { pid: string; onDone: () => void }) {
  const toast = useToast();
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<{ alias: string }>({ resolver: zodResolver(aliasSchema), defaultValues: { alias: "" } });
  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      const out = await api<{ existed: boolean }>(`/institutions/${pid}/aliases`, { json: v });
      toast({ kind: out.existed ? "info" : "success", title: out.existed ? "That alias is already recorded." : `Alias “${v.alias}” verified and added.` });
      reset();
      onDone();
    } catch (e) {
      setError(e);
    }
  });
  return (
    <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-2 border-t border-rule pt-4">
      <Field id="alias" label="Add a verified alias" error={errors.alias?.message} hint="Data steward only. Recorded in the audit chain. Do not add a sibling campus as an alias.">
        <div className="flex gap-2">
          <input {...register("alias")} {...fieldA11y("alias", errors.alias?.message, true)} className={inputCls} placeholder="e.g. SVIE Nashik" />
          <Button type="submit" variant="secondary" busy={isSubmitting} icon={<Plus size={15} aria-hidden />}>Add</Button>
        </div>
      </Field>
      <ErrorNote error={error} />
    </form>
  );
}

function I360() {
  const { pid } = useParams<{ pid: string }>();
  const { me, t } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tab = (["overview", "cases", "graph", "alerts", "history"].includes(sp.get("tab") ?? "") ? sp.get("tab") : "overview") as Tab;
  const { data, error, isLoading, mutate } = useApi<Institution360>(`/institutions/${pid}`);
  if (isLoading) return <PageSkeleton label="Loading institution" />;
  if (error || !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  const i = data.institution;
  const open = data.cases.filter((c) => c.bucket !== "disposed" && c.bucket !== "rejected");
  const unitsOpen = data.by_unit.filter((u) => u.open).length;
  const alerts = (data.links?.length ?? 0) + data.clusters.length;
  const steward = can(me, "institutions.steward");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader crumbs={[{ label: t("nav.institutions"), href: "/institutions" }, { label: i.permanent_id }]}
        title={i.name}
        meta={<><span className="font-mono">{i.permanent_id}</span><span className="flex items-center gap-1"><MapPin size={12} aria-hidden />{i.city}, {i.state}</span>{i.region && <span>{i.region.name}</span>}</>}
        actions={<>{i.approval_status === "APPROVED" ? <Badge tone="ok">AICTE approved</Badge> : <Badge tone="danger">{i.approval_status.toLowerCase()}</Badge>}{data.multi_unit && <Badge tone="coord" icon={<Users size={12} aria-hidden />}>Open matters in {unitsOpen} units</Badge>}</>} />

      {data.restricted_matter_exists && (
        <p className="flex items-center gap-2 rounded-lg border border-rule bg-surface-2 px-4 py-3 text-sm"><Lock size={16} aria-hidden />A restricted matter also exists on this institution. Contact the nodal officer for coordination.</p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Open cases" value={open.length} icon={<Building2 size={18} />} tone="info" hint={`${data.cases.length} in total`} />
        <KpiCard label="Units with open matters" value={unitsOpen} icon={<Users size={18} />} tone={unitsOpen >= 2 ? "coord" : "neutral"} hint={data.by_unit.filter((u) => u.open).map((u) => u.unit).join(", ") || "none"} />
        <KpiCard label="Related-case alerts" value={alerts} icon={<GitMerge size={18} />} tone={alerts ? "warn" : "neutral"} hint="links and confirmed clusters" />
        <KpiCard label="Verified aliases" value={data.aliases.length} icon={<Link2 size={18} />} tone="neutral" hint="name variants that resolve here" />
      </div>

      <Tabs idBase="i360" label="Institution sections" value={tab} onChange={(v) => router.replace(`${pathname}${v === "overview" ? "" : `?tab=${v}`}`, { scroll: false })} items={[
        { value: "overview", label: "Identity & units", icon: <Landmark size={15} aria-hidden /> },
        { value: "cases", label: "Cases", count: data.cases.length },
        { value: "graph", label: "Case graph", icon: <Network size={15} aria-hidden /> },
        { value: "alerts", label: "Related-case alerts", count: alerts },
        { value: "history", label: "History", icon: <History size={15} aria-hidden /> },
      ]} />
      <TabPanel idBase="i360" value={tab}>
        {tab === "overview" && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card title="Official identity" description="From the AICTE institution master.">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Permanent ID</dt><dd className="font-mono">{i.permanent_id}</dd>
                <dt className="text-muted">Official name</dt><dd className="font-medium">{i.name}</dd>
                <dt className="text-muted">Address</dt><dd>{i.address}, {i.city}, {i.state} {i.pin}</dd>
                <dt className="text-muted">Region</dt><dd>{i.region?.name ?? "—"}</dd>
                <dt className="text-muted">Type</dt><dd>{label(i.inst_type)}</dd>
                <dt className="text-muted">Trust / society</dt><dd>{i.trust_name ?? "—"}</dd>
              </dl>
              <div className="mt-4 border-t border-rule pt-4">
                <p className="text-sm font-semibold">Verified aliases</p>
                {data.aliases.length === 0 ? <p className="mt-1 text-sm text-muted">None recorded.</p> : (
                  <ul className="mt-2 flex flex-wrap gap-1.5">{data.aliases.map((a) => <li key={a.alias}><Badge title={`Source: ${label(a.source)}`}>{a.alias} <span className="opacity-60">· {label(a.source)}</span></Badge></li>)}</ul>
                )}
              </div>
              {data.siblings.length > 0 && (
                <div className="mt-4 border-t border-rule pt-4">
                  <p className="text-sm font-semibold">Sibling campuses (same trust)</p>
                  <p className="text-xs text-muted">Different institutions. Never merged automatically; an officer confirms which campus a complaint concerns.</p>
                  <ul className="mt-2 flex flex-col gap-1 text-sm">{data.siblings.map((s) => <li key={s.permanent_id}><Link className="text-action-ink hover:underline" href={`/institutions/${s.permanent_id}`}>{s.name}, {s.city}</Link> <span className="font-mono text-xs text-muted">{s.permanent_id}</span></li>)}</ul>
                </div>
              )}
              {steward && <AddAlias pid={i.permanent_id} onDone={() => void mutate()} />}
            </Card>
            <Card title="Cases across participating units" padded={false}>
              {data.by_unit.length === 0 ? <p className="p-5 text-sm text-muted">{steward ? "Case data is not shown to the data-steward role." : "No cases on this institution."}</p> : (
                <ul className="divide-y divide-rule">
                  {data.by_unit.map((u) => (
                    <li key={u.unit} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{u.unit} <span className="font-normal text-muted">· {u.unit_name}</span></p>
                        <p className="truncate text-xs text-muted">{u.custodians.length ? `Held by ${u.custodians.join(", ")}` : "No open matters"}</p>
                      </div>
                      <p className="shrink-0 text-right text-sm"><b className="tabular">{u.open}</b> <span className="text-xs text-muted">open / {u.total}</span></p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
        {tab === "cases" && (data.cases.length === 0 ? <EmptyState title="No cases visible to you on this institution." /> : <CaseTable rows={data.cases} columns={REGISTER_COLUMNS} caption={`Cases on ${i.name}`} />)}
        {tab === "graph" && (
          <Card title="Institutional case graph" description="Units holding this institution's cases, the cases, and the overlap links between them. Links across units are where coordination is needed.">
            <CaseGraph data={data} />
          </Card>
        )}
        {tab === "alerts" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Links between these cases" description="Proposed links are evidence for review, not confirmed duplicates." padded={false}>
              {(data.links?.length ?? 0) === 0 ? <p className="p-5 text-sm text-muted">No links.</p> : (
                <ul className="divide-y divide-rule">
                  {data.links!.map((l) => (
                    <li key={l.a + l.b} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                      <span className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                        <Link className="text-action-ink hover:underline" href={`/cases/${l.a}`}>{l.a}</Link><span className="text-muted">↔</span><Link className="text-action-ink hover:underline" href={`/cases/${l.b}`}>{l.b}</Link>
                      </span>
                      <span className="flex flex-wrap gap-1.5"><OverlapTypeBadge type={l.type} prob={l.probability} /><Badge tone={l.status === "CONFIRMED" ? "ok" : l.status === "REJECTED" ? "neutral" : "warn"}>{label(l.status)}</Badge></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Confirmed clusters (same matter)" description="Groups of cases that officers confirmed as the same matter.">
              {data.clusters.length === 0 ? <p className="text-sm text-muted">No confirmed clusters yet.</p> : (
                <ul className="flex flex-col gap-2">{data.clusters.map((c) => <li key={c.join()} className={cx("rounded-lg bg-ok-soft px-3 py-2 font-mono text-xs text-ok-ink")}>{c.join(" · ")}</li>)}</ul>
              )}
            </Card>
          </div>
        )}
        {tab === "history" && <Card title="Case history across units" description="When each case was received, by holding unit."><Constellation cases={data.cases} /></Card>}
      </TabPanel>
    </div>
  );
}

export default function Institution360Page() {
  return <Require cap="institutions.view"><Suspense fallback={<PageSkeleton />}><I360 /></Suspense></Require>;
}
