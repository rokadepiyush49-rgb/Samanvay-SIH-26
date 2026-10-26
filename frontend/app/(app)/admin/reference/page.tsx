"use client";

import { Card, ErrorState, PageSkeleton, Table } from "@/components/ui";
import { StatusBadge } from "@/components/status";
import { useApi } from "@/lib/api";
import { label } from "@/lib/format";
import type { Meta } from "@/lib/types";

export default function AdminReference() {
  const { data, error, mutate } = useApi<Meta>("/meta");
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return <PageSkeleton rows={4} />;
  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-lg border border-rule bg-surface-2 px-4 py-3 text-sm text-muted">Read-only. Units, statuses and categories come from the reference-data migration and are marked <i>proposed</i> until AICTE signs them off. Editing them in the interface is not supported yet.</p>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title={`Units (${data.units.length})`} padded={false}>
          <Table className="rounded-none border-0 shadow-none" caption="Units" head={["Code", "Name", "Type", "Region"]} minWidth={420}>
            {data.units.map((u) => <tr key={u.code}><td className="font-semibold">{u.code}</td><td>{u.name}</td><td>{label(u.unit_type)}</td><td>{data.regions.find((r) => r.id === u.region_id)?.name ?? "—"}</td></tr>)}
          </Table>
        </Card>
        <Card title={`Statuses and reporting categories (${data.statuses.length})`} padded={false}>
          <Table className="rounded-none border-0 shadow-none" caption="Statuses" head={["Status", "Code", "Reporting category"]} minWidth={420}>
            {data.statuses.map((s) => <tr key={s.code}><td><StatusBadge bucket={s.bucket} label={s.label} /></td><td className="font-mono text-xs">{s.code}</td><td>{label(s.bucket)}</td></tr>)}
          </Table>
        </Card>
      </div>
      <Card title={`Complaint categories (${data.categories.length})`} padded={false}>
        <Table className="rounded-none border-0 shadow-none" caption="Categories" head={["Category", "Hindi", "Group", "Sensitivity"]} minWidth={560}>
          {data.categories.map((c) => <tr key={c.code}><td><p className="font-medium">{c.name}</p><p className="font-mono text-[11px] text-muted">{c.code}</p></td><td lang="hi">{c.name_hi ?? "—"}</td><td>{label(c.group_code)}</td><td>{c.sensitivity === "NORMAL" ? "Normal" : label(c.sensitivity)}</td></tr>)}
        </Table>
      </Card>
      <Card title="Consequential actions" description="Actions that run the Action Conflict Guard first.">
        <ul className="flex flex-wrap gap-1.5">{data.consequential_actions.map((a) => <li key={a} className="rounded-md bg-surface-2 px-2 py-1 text-xs font-medium">{label(a)}</li>)}</ul>
      </Card>
    </div>
  );
}
