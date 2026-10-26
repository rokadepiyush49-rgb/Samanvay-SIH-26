"use client";

import { ArrowLeftRight, Cpu, GitMerge, UserX } from "lucide-react";
import { ErrorState, KpiCard, PageSkeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { label } from "@/lib/format";

type Health = { orphan_open_cases: number; orphan_examples: string[]; stuck_transfers: number; unmatched_open_cases: number; jobs: Record<string, number>; dead_jobs: { id: number; kind: string; error: string }[] };

export default function AdminHealth() {
  const { data, error, mutate } = useApi<Health>("/admin/health", { refreshInterval: 15000 });
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return <PageSkeleton rows={2} />;
  const dead = data.jobs.DEAD ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Open cases without a custodian" value={data.orphan_open_cases} tone={data.orphan_open_cases ? "danger" : "ok"} icon={<UserX size={18} />} hint={data.orphan_open_cases ? `e.g. ${data.orphan_examples.slice(0, 3).join(", ")}` : "target: zero"} />
        <KpiCard label="Transfers waiting > 7 days" value={data.stuck_transfers} tone={data.stuck_transfers ? "warn" : "ok"} icon={<ArrowLeftRight size={18} />} href="/transfers?view=incoming" />
        <KpiCard label="Open cases not yet matched" value={data.unmatched_open_cases} tone="info" icon={<GitMerge size={18} />} hint="overlap engine queue" />
        <KpiCard label="Job queue" value={dead ? `${dead} failed` : "Healthy"} tone={dead ? "danger" : "ok"} icon={<Cpu size={18} />} hint={Object.entries(data.jobs).map(([k, v]) => `${label(k)} ${v}`).join(" · ") || "empty"} />
      </div>
      {data.dead_jobs.length > 0 && (
        <ul className="rounded-xl border border-danger/30 bg-danger-soft p-4 font-mono text-xs text-danger-ink">{data.dead_jobs.map((j) => <li key={j.id}>{j.kind}: {j.error}</li>)}</ul>
      )}
      <p className="text-xs text-muted">Refreshes every 15 seconds.</p>
    </div>
  );
}
