"use client";

import { useState } from "react";
import { BarChart, ChartCard, STATUS_SERIES } from "@/components/charts";
import { ErrorState, PageSkeleton, Tabs } from "@/components/ui";
import { ScopeFilter, scopeLabel, useCockpitScope } from "../cockpit/scope";
import { qs, useApi } from "@/lib/api";
import { fmtDateTime, pct } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import type { Analytics, BreakdownRow, Meta } from "@/lib/types";
import { CatalogueView } from "@/components/reports";

type Dim = "unit" | "region" | "category";
const DIM: Record<Dim, { title: string; param: string; report: string }> = {
  unit: { title: "Bureau / cell", param: "unit", report: "UNIT_STATUS" },
  region: { title: "Region", param: "region", report: "REGION_STATUS" },
  category: { title: "Complaint category", param: "category", report: "STATUS_SUMMARY" },
};

function Breakdown({ dim, rows, scope }: { dim: Dim; rows: BreakdownRow[]; scope: Record<string, string> }) {
  const shown = rows.filter((r) => r.total > 0);
  return (
    <ChartCard title={`Status by ${DIM[dim].title.toLowerCase()}`} legend={STATUS_SERIES}
      description={dim === "category" ? "Top 12 categories by open cases." : "All cases in scope, split by reporting category."}
      table={{ head: [DIM[dim].title, "Total", "Pending", "Under process", "Disposed", "Transfer in flight", "Overdue", "Within timeline (90 d)"],
        rows: shown.map((r) => [r.name, r.total, r.pending, r.under_process, r.disposed, r.transferred, r.overdue, pct(r.sla_pct)]) }}
      footer="Select a bar to open those cases in the register. Switch to Table for overdue counts and timeliness.">
      <BarChart label={`Cases by ${DIM[dim].title}`} series={STATUS_SERIES}
        rows={shown.map((r) => ({ key: String(r.key), label: dim === "unit" ? String(r.key) : r.name, sub: dim === "unit" ? r.name : undefined, note: r.overdue ? `${r.overdue} overdue` : undefined,
          href: `/cases${qs({ ...scope, [DIM[dim].param]: String(r.key) })}`, segments: { pending: r.pending, under_process: r.under_process, disposed: r.disposed, transferred: r.transferred } }))} />
    </ChartCard>
  );
}

export default function ReportsAnalytics() {
  const { me } = useSession();
  const { unit, region, query } = useCockpitScope();
  const [dim, setDim] = useState<Dim>("unit");
  const allowed = can(me, "cockpit.view");
  const { data, error, isLoading, mutate } = useApi<Analytics>(allowed ? `/dashboard/analytics${query}` : null);
  const { data: meta } = useApi<Meta>("/meta");
  if (!allowed) return <CatalogueView />;
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  const scope = { unit, region };
  const rows = dim === "unit" ? data.by_unit : dim === "region" ? data.by_region : data.by_category;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule bg-surface px-4 py-3 text-sm shadow-card">
        <p><span className="text-muted">Scope</span> <b>{scopeLabel(data.scope, meta)}</b> <span className="text-muted">· live data generated {fmtDateTime(data.as_of)}</span></p>
        <ScopeFilter />
      </div>
      <Tabs idBase="dim" label="Break down by" value={dim} onChange={setDim} items={[
        { value: "unit", label: "By bureau / cell" }, { value: "region", label: "By region" }, { value: "category", label: "By category" },
      ]} />
      <div role="tabpanel" id={`dim-panel-${dim}`} aria-labelledby={`dim-tab-${dim}`}>
        <Breakdown dim={dim} rows={rows} scope={scope} />
      </div>
      <p className="text-xs text-muted">Need numbers for a meeting? Generate the matching frozen report (“{DIM[dim].report.replaceAll("_", " ").toLowerCase()}”) in the Report catalogue so they can be reproduced later.</p>
    </div>
  );
}
