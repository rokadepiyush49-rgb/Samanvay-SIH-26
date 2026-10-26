"use client";

import { AlarmClock, ArrowLeftRight, Briefcase, CheckCircle2, CircleDashed, Clock, Network, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { BarChart, ChartCard, LineChart, STATUS_SERIES, type Series } from "@/components/charts";
import { ErrorState, KpiCard, PageSkeleton, type Tone } from "@/components/ui";
import { qs } from "@/lib/api";
import { fmtMonth, num, pct } from "@/lib/format";
import { useCockpitData, useCockpitScope } from "./scope";

const TILE: Record<string, { icon: ReactNode; tone: Tone }> = {
  total: { icon: <Briefcase size={18} />, tone: "navy" },
  pending: { icon: <Clock size={18} />, tone: "warn" },
  under_process: { icon: <CircleDashed size={18} />, tone: "info" },
  disposed: { icon: <CheckCircle2 size={18} />, tone: "ok" },
  transferred: { icon: <ArrowLeftRight size={18} />, tone: "coord" },
  escalated: { icon: <TrendingUp size={18} />, tone: "danger" },
  overdue: { icon: <AlarmClock size={18} />, tone: "danger" },
};

const TREND: Series[] = [
  { key: "received", name: "Received", color: "var(--series-2)" },
  { key: "disposed", name: "Disposed", color: "var(--series-3)" },
];

export default function CockpitOverview() {
  const { unit, region } = useCockpitScope();
  const { summary, analytics } = useCockpitData();
  if (summary.isLoading) return <PageSkeleton label="Loading cockpit" />;
  if (summary.error || !summary.data) return <ErrorState error={summary.error} onRetry={() => summary.mutate()} />;
  const s = summary.data;
  const a = analytics.data;
  const trend = (a?.trend ?? []).map((t) => ({ x: t.month, label: fmtMonth(t.month), values: { received: t.received, disposed: t.disposed, on_time: t.on_time } }));
  const units = (a?.by_unit ?? []).filter((u) => u.total > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {s.tiles.map((t) => <KpiCard key={t.key} label={t.label} value={num(t.value)} icon={TILE[t.key]?.icon} tone={TILE[t.key]?.tone ?? "neutral"} href={`/cases?${t.query}`} testId={`tile-${t.key}`} />)}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard label="Disposed within timeline" value={pct(s.within_timeline.pct)} icon={<CheckCircle2 size={18} />} tone="ok"
          hint={`${num(s.within_timeline.on_time)} of ${num(s.within_timeline.disposed)} disposals in the last ${s.within_timeline.window_days} days`} />
        <KpiCard label="Undecided overlaps" value={num(s.undecided_overlaps.count)} icon={<Network size={18} />} tone="coord"
          hint={`oldest ${s.undecided_overlaps.oldest_working_days ?? 0} working days`} href="/coordination" />
        <KpiCard label="Institutions with matters in 2+ units" value={num(s.multi_unit_institutions)} icon={<Briefcase size={18} />} tone="info" href="/institutions" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard title="Received vs disposed, by month" description="Last 12 months, in scope. Hover or use the arrow keys for monthly values."
          legend={TREND} table={{ head: ["Month", "Received", "Disposed", "Within timeline"], rows: (a?.trend ?? []).map((t) => [fmtMonth(t.month), t.received, t.disposed, t.on_time]) }}>
          {a ? <LineChart points={trend} series={TREND} label="Monthly received and disposed cases" /> : <div className="h-60 skeleton rounded-lg" />}
        </ChartCard>
        <ChartCard title="Case distribution by bureau / cell" description="Cases held by each unit, split by reporting category (rejected-at-intake cases are not plotted). Select a unit to open its cases."
          legend={STATUS_SERIES} table={{ head: ["Unit", "Pending", "Under process", "Disposed", "Transfer in flight", "Total"], rows: units.map((u) => [String(u.key), u.pending, u.under_process, u.disposed, u.transferred, u.total]) }}>
          {a ? <BarChart label="Cases by unit and status" series={STATUS_SERIES}
            rows={units.map((u) => ({ key: String(u.key), label: String(u.key), sub: u.name, href: `/cases${qs({ unit: String(u.key), region })}`, segments: { pending: u.pending, under_process: u.under_process, disposed: u.disposed, transferred: u.transferred } }))} /> : <div className="h-60 skeleton rounded-lg" />}
        </ChartCard>
      </div>
      {unit && <p className="text-xs text-muted">Scoped to {unit}. Use the scope selector to compare other units.</p>}
    </div>
  );
}
