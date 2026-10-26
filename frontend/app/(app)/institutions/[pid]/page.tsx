"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { CaseTable } from "@/components/cases";
import { IconLock } from "@/components/icons";
import { FadeIn, Stagger, StaggerItem } from "@/components/motion";
import { Badge, Card, Empty, ErrorNote, Spinner, TypeBadge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate, label } from "@/lib/format";
import { hasRole, useSession } from "@/lib/session";
import type { CaseRow } from "@/lib/types";

type I360 = {
  institution: { permanent_id: string; name: string; address: string; city: string; state: string; pin: string; region: { code: string; name: string } | null; inst_type: string; approval_status: string; trust_name: string | null };
  aliases: { alias: string; source: string }[];
  siblings: { permanent_id: string; name: string; city: string }[];
  cases: CaseRow[];
  by_unit: { unit: string; unit_name: string; open: number; total: number; custodians: string[] }[];
  links?: { a: string; b: string; type: string; status: string; probability: number }[];
  clusters: string[][];
  restricted_matter_exists: boolean;
  multi_unit?: boolean;
};

const DOT: Record<string, string> = { pending: "var(--yellow-ink)", under_process: "var(--sky-ink)", disposed: "var(--mint-ink)", rejected: "var(--muted)", transferred: "var(--pink-ink)" };
const TONES = ["bg-yellow text-yellow-ink", "bg-mint text-mint-ink", "bg-pink text-pink-ink", "bg-sky text-sky-ink"];

/** Case constellation: one lane per unit, one mark per case on a shared time axis; shape encodes open (ring) or closed (dot). */
function Constellation({ cases }: { cases: CaseRow[] }) {
  const [now] = useState(() => Date.now());
  if (cases.length === 0) return null;
  const units = [...new Set(cases.map((c) => c.holding_unit.code))];
  const times = cases.map((c) => new Date(c.received_on).getTime());
  const lo = Math.min(...times) - 7 * 864e5;
  const hi = Math.max(now, ...times) + 7 * 864e5;
  const W = 900, lane = 46, left = 70, H = units.length * lane + 34;
  const x = (t: number) => left + ((t - lo) / (hi - lo)) * (W - left - 16);
  const months: number[] = [];
  const d = new Date(lo); d.setDate(1); d.setMonth(d.getMonth() + 1);
  while (d.getTime() < hi) { months.push(d.getTime()); d.setMonth(d.getMonth() + 1); }
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[640px]" role="img" aria-label="Timeline of this institution's cases by unit">
        {months.map((m) => (
          <g key={m}>
            <line x1={x(m)} x2={x(m)} y1={4} y2={H - 26} stroke="var(--rule)" />
            <text x={x(m)} y={H - 10} fontSize="11" fill="var(--muted)" textAnchor="middle">{new Date(m).toLocaleString("en-IN", { month: "short", year: "2-digit" })}</text>
          </g>
        ))}
        {units.map((u, i) => (
          <g key={u}>
            <text x={8} y={i * lane + 28} fontSize="12" fontWeight="700" fill="var(--ink)">{u}</text>
            <line x1={left} x2={W - 16} y1={i * lane + 24} y2={i * lane + 24} stroke="var(--rule)" strokeDasharray="3 4" />
          </g>
        ))}
        {cases.map((c) => {
          const i = units.indexOf(c.holding_unit.code);
          const open = c.bucket !== "disposed" && c.bucket !== "rejected";
          const cx = x(new Date(c.received_on).getTime());
          return (
            <a key={c.id} href={`/cases/${c.case_no}`}>
              <title>{`${c.case_no} · ${c.category.name} · ${c.status_label} · received ${fmtDate(c.received_on)}`}</title>
              <circle cx={cx} cy={i * lane + 24} r={open ? 8 : 6} fill={open ? "var(--surface)" : DOT[c.bucket]} stroke={DOT[c.bucket]} strokeWidth={open ? 3 : 0} />
              {c.overlaps.parallel_open > 0 && <circle cx={cx} cy={i * lane + 24} r={13} fill="none" stroke="var(--pink-ink)" strokeWidth={1.5} strokeDasharray="2 2" />}
            </a>
          );
        })}
      </svg>
      <p className="mt-1 text-xs text-muted">Ring = open case · dot = closed · dashed halo = undecided parallel-action overlap. Select a mark to open the case.</p>
    </div>
  );
}

export default function Institution360() {
  const { pid } = useParams<{ pid: string }>();
  const { me } = useSession();
  const { data, error, isLoading } = useApi<I360>(`/institutions/${pid}`);
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} />;
  const i = data.institution;
  return (
    <FadeIn className="flex flex-col gap-5">
      <section className="rounded-[2rem] bg-navy p-6 text-on-navy sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky">Institution 360 · {i.permanent_id}</p>
        <h1 className="mt-2 text-3xl font-extrabold leading-tight text-white sm:text-5xl">{i.name}</h1>
        <p className="mt-2 text-sm">{i.address} · {i.city}, {i.state} {i.pin} · {i.region?.name}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {i.approval_status === "APPROVED" ? <Badge tone="ok">AICTE approved</Badge> : <Badge tone="danger">{i.approval_status.toLowerCase()}</Badge>}
          {i.trust_name && <Badge tone="info">{i.trust_name}</Badge>}
          {data.multi_unit && <Badge tone="warn">⚑ Open matters in {data.by_unit.filter((u) => u.open).length} units</Badge>}
        </div>
        {data.aliases.length > 0 && <p className="mt-4 text-xs text-sky">Also written as: {data.aliases.map((a) => a.alias).join(" · ")}</p>}
      </section>

      {data.restricted_matter_exists && (
        <Card tone="cream" className="flex items-center gap-3"><IconLock /><p className="text-sm font-semibold">A restricted matter also exists on this institution. Contact the nodal officer.</p></Card>
      )}

      {hasRole(me, "DATA_STEWARD") && data.cases.length === 0 && <Empty title="Case data is not shown to the data-steward role.">Aliases and master fields are editable from the API.</Empty>}

      {data.by_unit.length > 0 && (
        <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {data.by_unit.map((u, k) => (
            <StaggerItem key={u.unit}>
              <div className={`h-full rounded-3xl p-5 ${TONES[k % TONES.length]}`}>
                <p className="text-sm font-bold">{u.unit_name}</p>
                <p className="mt-1 text-4xl font-extrabold tabular">{u.open}<span className="text-base font-semibold opacity-70"> open / {u.total}</span></p>
                <p className="mt-2 text-xs">{u.custodians.length ? `Held by ${u.custodians.join(", ")}` : "No open matters"}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      )}

      {data.cases.length > 0 && <Card><h2 className="mb-3 font-bold">Case constellation across units</h2><Constellation cases={data.cases} /></Card>}

      {((data.links?.length ?? 0) > 0 || data.clusters.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="font-bold">Links between these cases</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {data.links?.slice(0, 12).map((l) => (
                <li key={l.a + l.b} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3 py-2">
                  <span className="font-mono text-xs">{l.a} ↔ {l.b}</span>
                  <span className="flex flex-wrap gap-1"><TypeBadge type={l.type} prob={l.probability} /><Badge>{label(l.status)}</Badge></span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="font-bold">Confirmed clusters (same matter)</h2>
            {data.clusters.length === 0 ? <p className="mt-2 text-sm text-muted">No confirmed links yet.</p> : (
              <ul className="mt-3 flex flex-col gap-2 text-sm">{data.clusters.map((c) => <li key={c.join()} className="rounded-2xl bg-mint px-3 py-2 font-mono text-xs text-mint-ink">{c.join(" · ")}</li>)}</ul>
            )}
            {data.siblings.length > 0 && <p className="mt-4 text-xs text-muted">Sibling campuses of the same trust (never merged automatically): {data.siblings.map((s) => `${s.name}, ${s.city}`).join("; ")}</p>}
          </Card>
        </div>
      )}

      {data.cases.length > 0 && <><h2 className="text-lg font-extrabold">All cases ({data.cases.length})</h2><CaseTable rows={data.cases} /></>}
    </FadeIn>
  );
}
