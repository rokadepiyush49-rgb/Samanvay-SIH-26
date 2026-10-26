"use client";

import Link from "next/link";
import { BarChart, ChartCard, ColumnChart, type Series } from "@/components/charts";
import { Card, ErrorState, PageSkeleton, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { pct } from "@/lib/format";
import { useCockpitData, useCockpitScope } from "../scope";

const OPEN: Series[] = [
  { key: "overdue", name: "Overdue", color: "var(--series-1)" },
  { key: "on_track", name: "Within timeline", color: "var(--series-2)" },
];

export default function Workload() {
  const { unit, region } = useCockpitScope();
  const { summary, analytics } = useCockpitData();
  if (summary.isLoading) return <PageSkeleton />;
  if (summary.error || !summary.data) return <ErrorState error={summary.error} onRetry={() => summary.mutate()} />;
  const s = summary.data;
  const regions = (analytics.data?.by_region ?? []).filter((r) => r.total > 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard title="Pending-case ageing" description="Open cases by working days since receipt. The oldest bucket is highlighted."
          table={{ head: ["Working days", "Open cases"], rows: s.ageing.map((a) => [a.bucket, a.count]) }}>
          <ColumnChart label="Open cases by age" bars={s.ageing.map((a) => ({ key: a.bucket, label: `${a.bucket} d`, value: a.count, emphasis: a.bucket === ">60", href: `/cases${qs({ unit, region, open_only: true, order: "due" })}` }))} />
        </ChartCard>
        <ChartCard title="Open workload by bureau / cell" description="Open cases per unit, with the overdue share. Select a unit to see its overdue cases."
          legend={OPEN} table={{ head: ["Unit", "Open", "Overdue", "0–10 d", "11–21 d", "22–60 d", ">60 d"], rows: s.workload.map((w) => [w.unit, w.open, w.overdue, w["0–10"], w["11–21"], w["22–60"], w[">60"]]) }}>
          <BarChart label="Open cases by unit" series={OPEN}
            rows={s.workload.map((w) => ({ key: w.unit, label: w.unit, href: `/cases${qs({ unit: w.unit, region, overdue: true })}`, segments: { overdue: w.overdue, on_track: Math.max(0, w.open - w.overdue) }, note: `${w.overdue} overdue` }))} />
        </ChartCard>
      </div>
      <ChartCard title="Regional workload" description="Cases by region of the institution. Select a region to open its open cases."
        legend={OPEN} table={{ head: ["Region", "Total", "Open (pending + under process)", "Overdue", "Disposed"], rows: regions.map((r) => [r.name, r.total, r.pending + r.under_process + r.transferred, r.overdue, r.disposed]) }}>
        {analytics.data ? <BarChart label="Cases by region" series={OPEN}
          rows={regions.map((r) => ({ key: String(r.key), label: r.name, href: `/cases${qs({ region: String(r.key), open_only: true })}`, segments: { overdue: r.overdue, on_track: Math.max(0, r.pending + r.under_process + r.transferred - r.overdue) }, note: `${r.disposed} disposed` }))} /> : <div className="h-40 skeleton rounded-lg" />}
      </ChartCard>
      <Card title="Register health" description="Share of open cases with a confirmed institution, an assigned officer, and activity in the last 30 days." padded={false}>
        <Table caption="Register health by unit" className="rounded-none border-0 shadow-none" head={["Unit", "Open", "Institution confirmed", "Officer assigned", "Stale (30 d)", "Score"]} minWidth={560}>
          {s.register_health.map((h) => (
            <tr key={h.unit}>
              <td><Link className="font-semibold text-action-ink hover:underline" href={`/cases${qs({ unit: h.unit, open_only: true })}`}>{h.unit}</Link></td>
              <td className="tabular">{h.open}</td><td className="tabular">{pct(h.resolved_pct)}</td><td className="tabular">{pct(h.assigned_pct)}</td><td className="tabular">{pct(h.stale_pct)}</td>
              <td className="font-semibold tabular">{h.score ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
