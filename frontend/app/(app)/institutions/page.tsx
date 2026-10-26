"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Empty, ErrorNote, Field, PageHead, Spinner, Table, inputCls } from "@/components/ui";
import { qs, useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";

type Inst = { id: string; permanent_id: string; name: string; city: string; state: string; region_code: string; approval_status: string; open_cases: number; total_cases: number; units_involved: number; units: string[]; oldest_open: string | null };

export default function InstitutionsPage() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState({ q: "", sort: "units", multi: true });
  const { data, error, isLoading } = useApi<{ items: Inst[] }>(`/institutions${qs({ q: applied.q, sort: applied.sort, multi_unit: applied.multi || undefined, limit: 100 })}`);
  return (
    <div className="flex flex-col gap-5">
      <PageHead title="Institutions">
        The AICTE institution master with every case across units. Names are matched fuzzily, so “S.V. Inst. Engg Nashik” finds the official record.
      </PageHead>
      <form className="grid gap-3 rounded-3xl border border-rule bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_200px_auto_auto] sm:items-end"
        onSubmit={(e) => { e.preventDefault(); setApplied({ ...applied, q }); }}>
        <Field label="Name or Permanent ID"><input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Sahyadri Valley Inst or 1-9990001234" /></Field>
        <Field label="Sort by">
          <select className={inputCls} value={applied.sort} onChange={(e) => setApplied({ ...applied, sort: e.target.value })}>
            <option value="units">Units involved</option><option value="open">Open cases</option><option value="oldest">Oldest open</option><option value="name">Name</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 pb-2.5 text-sm font-semibold">
          <input type="checkbox" className="h-4 w-4 accent-[var(--navy)]" checked={applied.multi} onChange={(e) => setApplied({ ...applied, multi: e.target.checked })} />
          Matters in 2+ units
        </label>
        <Button type="submit">Search</Button>
      </form>
      {isLoading && <Spinner />}
      <ErrorNote error={error} />
      {data && (data.items.length === 0 ? <Empty title="No institutions match." /> : (
        <Table head={["Institution", "Region", "Open", "Units involved", "Oldest open", "Status"]}>
          {data.items.map((i) => (
            <tr key={i.id} className="hover:bg-surface-2">
              <td><Link className="font-bold hover:underline" href={`/institutions/${i.permanent_id}`}>{i.name}</Link><p className="text-xs text-muted">{i.city}, {i.state} · {i.permanent_id}</p></td>
              <td>{i.region_code}</td>
              <td className="tabular">{i.open_cases} <span className="text-xs text-muted">/ {i.total_cases}</span></td>
              <td><span className="flex flex-wrap gap-1">{i.units.map((u) => <Badge key={u} tone={i.units_involved >= 2 ? "warn" : "plain"}>{u}</Badge>)}</span></td>
              <td>{fmtDate(i.oldest_open)}</td>
              <td>{i.approval_status === "APPROVED" ? <Badge tone="ok">Approved</Badge> : <Badge tone="danger">{i.approval_status.toLowerCase()}</Badge>}</td>
            </tr>
          ))}
        </Table>
      ))}
    </div>
  );
}
