"use client";

import { useState } from "react";
import { Badge, ErrorState, Table, TableSkeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDateTime, label } from "@/lib/format";

type Row = { email: string; full_name: string; unit: string; roles: string[]; sealed_clearance: boolean; is_active: boolean; last_login_at: string | null; active_grants: number };

export function AccessReview() {
  const { data, error, mutate } = useApi<{ items: Row[] }>("/admin/access-review");
  const [now] = useState(() => Date.now());
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return <TableSkeleton rows={8} />;
  const stale = data.items.filter((r) => r.is_active && (!r.last_login_at || now - new Date(r.last_login_at).getTime() > 90 * 864e5)).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Who can see what, for periodic access reviews. <b className="text-ink">{stale}</b> active accounts have not signed in for 90 days.</p>
      <Table caption="Access review" head={["Official", "Unit", "Roles", "Sealed clearance", "Active grants", "Last sign-in", "Status"]}>
        {data.items.map((r) => (
          <tr key={r.email}>
            <td><p className="font-medium">{r.full_name}</p><p className="text-xs text-muted">{r.email}</p></td>
            <td className="font-semibold">{r.unit}</td>
            <td><span className="flex max-w-xs flex-wrap gap-1">{r.roles.map((x) => <Badge key={x}>{label(x)}</Badge>)}</span></td>
            <td>{r.sealed_clearance ? <Badge tone="warn">Cleared</Badge> : "—"}</td>
            <td className="tabular">{r.active_grants}</td>
            <td className="whitespace-nowrap text-xs">{fmtDateTime(r.last_login_at)}</td>
            <td>{r.is_active ? <Badge tone="ok">Active</Badge> : <Badge>Disabled</Badge>}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
