"use client";

import { Play } from "lucide-react";
import { useState } from "react";
import { BarChart, ChartCard, type Series } from "@/components/charts";
import { Button, Card, ErrorNote, ErrorState, Field, KpiCard, PageSkeleton, inputCls } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { fmtDate, num, pct } from "@/lib/format";
import { useCockpitData, useCockpitScope } from "../scope";

type Sim = { units: { unit: string; cases: number; breaches_current: number; breaches_proposed: number }[]; totals: { cases: number; breaches_current: number; breaches_proposed: number }; note: string; period: { from: string; to: string } };

const SLA: Series[] = [{ key: "pct", name: "Within timeline", color: "var(--series-3)" }];
const SIM: Series[] = [
  { key: "current", name: "Breaches under current policy", color: "var(--series-2)" },
  { key: "proposed", name: "Breaches under proposal", color: "var(--series-1)" },
];

function Simulator() {
  const { unit } = useCockpitScope();
  const [target, setTarget] = useState(21);
  const [basis, setBasis] = useState<"CALENDAR" | "WORKING">("CALENDAR");
  const [channel, setChannel] = useState("CPGRAMS");
  const [out, setOut] = useState<Sim | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setOut(await api<Sim>("/simulations/sla", { json: { target_days: target, day_basis: basis, channel: channel || null, unit: unit || null } }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="SLA what-if simulator" description="Replays the last 90 days of real cases under a proposed timeline. A replay of history, not a forecast; nothing is changed.">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_150px_auto] sm:items-end">
        <Field id="sim-target" label={`Proposed target: ${target} ${basis === "WORKING" ? "working" : "calendar"} days`}>
          <input id="sim-target" type="range" min={5} max={90} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="accent-[var(--action)]" />
        </Field>
        <Field id="sim-basis" label="Day basis"><select id="sim-basis" className={inputCls} value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}><option value="CALENDAR">Calendar</option><option value="WORKING">Working</option></select></Field>
        <Field id="sim-ch" label="Channel"><select id="sim-ch" className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">All</option><option value="CPGRAMS">CPGRAMS</option><option value="EMAIL">E-mail</option><option value="LETTER">Letter</option></select></Field>
        <Button busy={busy} onClick={run} icon={<Play size={15} aria-hidden />}>Run replay</Button>
      </div>
      <div className="mt-3"><ErrorNote error={error} /></div>
      {out && (
        <div className="mt-4 flex flex-col gap-4" aria-live="polite">
          <p className="text-sm">{fmtDate(out.period.from)} – {fmtDate(out.period.to)} · <b className="tabular">{num(out.totals.cases)}</b> cases · breaches today <b className="tabular">{num(out.totals.breaches_current)}</b> → under proposal <b className="tabular">{num(out.totals.breaches_proposed)}</b></p>
          <BarChart label="Breaches by unit, current vs proposed" series={SIM} rows={out.units.map((u) => ({ key: u.unit, label: u.unit, sub: `${u.cases} cases`, segments: { current: u.breaches_current, proposed: u.breaches_proposed } }))} />
          <p className="text-xs text-muted">{out.note}</p>
        </div>
      )}
    </Card>
  );
}

export default function Timeliness() {
  const { region } = useCockpitScope();
  const { summary, analytics } = useCockpitData();
  if (summary.isLoading) return <PageSkeleton />;
  if (summary.error || !summary.data) return <ErrorState error={summary.error} onRetry={() => summary.mutate()} />;
  const s = summary.data;
  const units = (analytics.data?.by_unit ?? []).filter((u) => u.disposed_90 > 0);
  const overdue = s.tiles.find((t) => t.key === "overdue");
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Disposed within timeline (90 days)" value={pct(s.within_timeline.pct)} tone="ok" hint={`${num(s.within_timeline.on_time)} of ${num(s.within_timeline.disposed)} disposals`} />
        <KpiCard label="Overdue open cases" value={num(overdue?.value)} tone="danger" href={overdue ? `/cases?${overdue.query}` : undefined} />
        <KpiCard label="Rejected at intake" value={num(s.rejected_at_intake)} tone="neutral" hint="not counted as pending" />
      </div>
      <ChartCard title="SLA compliance by bureau / cell" description="Share of cases disposed within their expected disposal date, last 90 days. Units without disposals in the window are omitted."
        table={{ head: ["Unit", "Within timeline", "Disposals (90 d)"], rows: units.map((u) => [String(u.key), pct(u.sla_pct), u.disposed_90]) }}>
        {analytics.data ? (units.length === 0 ? <p className="text-sm text-muted">No disposals in the last 90 days.</p> : (
          <BarChart label="Within-timeline rate by unit" series={SLA} max={100} format={(v) => `${v}%`}
            rows={units.map((u) => ({ key: String(u.key), label: String(u.key), sub: `${u.disposed_90} disposals`, href: `/cases${qs({ unit: String(u.key), region, status: "disposed" })}`, segments: { pct: u.sla_pct ?? 0 } }))} />
        )) : <div className="h-40 skeleton rounded-lg" />}
      </ChartCard>
      <Simulator />
    </div>
  );
}
