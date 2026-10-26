"use client";

import { Building2, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Require } from "@/components/require";
import { Badge, Button, EmptyState, ErrorNote, PageHeader, Table, TableSkeleton, cx, inputCls, rowClick } from "@/components/ui";
import { qs, useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { InstitutionListItem, Meta } from "@/lib/types";

function Institutions() {
  const { t } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const q = sp.get("q") ?? "";
  const sort = sp.get("sort") ?? "units";
  const region = sp.get("region") ?? "";
  const multi = sp.get("multi") !== "0";
  const [text, setText] = useState(q);
  const { data: meta } = useApi<Meta>("/meta");
  const { data, error, isLoading, mutate } = useApi<{ items: InstitutionListItem[] }>(`/institutions${qs({ q, sort, region, multi_unit: multi && !q ? true : undefined, limit: 100 })}`);
  const set = (patch: Record<string, string | undefined>) => router.replace(`${pathname}${qs({ q, sort, region, multi: multi ? undefined : "0", ...patch })}`, { scroll: false });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("nav.institutions")} crumbs={[{ label: t("group.institutions") }, { label: t("nav.institutions") }]}
        description="The AICTE institution master with every case across units. Names match fuzzily (“S.V. Inst. Engg Nashik” finds the official record); a Permanent ID matches exactly." />
      <form role="search" className="flex flex-wrap items-center gap-2 rounded-xl border border-rule bg-surface p-3 shadow-card" onSubmit={(e) => { e.preventDefault(); set({ q: text.trim() || undefined }); }}>
        <div className="relative min-w-[16rem] flex-1">
          <label htmlFor="i-q" className="sr-only">Institution name or Permanent ID</label>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input id="i-q" className={cx(inputCls, "pl-9")} value={text} onChange={(e) => setText(e.target.value)} placeholder="Institution name, alias or AICTE Permanent ID (1-…)" />
        </div>
        <label className="sr-only" htmlFor="i-region">Region</label>
        <select id="i-region" className={cx(inputCls, "w-auto")} value={region} onChange={(e) => set({ region: e.target.value || undefined })}>
          <option value="">All regions</option>
          {meta?.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="i-sort">Sort by</label>
        <select id="i-sort" className={cx(inputCls, "w-auto")} value={sort} onChange={(e) => set({ sort: e.target.value })}>
          <option value="units">Most units involved</option><option value="open">Most open cases</option><option value="oldest">Oldest open case</option><option value="name">Name</option>
        </select>
        <label className="flex items-center gap-2 px-1 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--action)]" checked={multi} onChange={(e) => set({ multi: e.target.checked ? undefined : "0" })} disabled={!!q} />
          Matters in 2+ units
        </label>
        <Button type="submit">{t("action.search")}</Button>
      </form>
      {isLoading && <TableSkeleton rows={8} />}
      <ErrorNote error={error} onRetry={() => mutate()} />
      {data && (data.items.length === 0 ? <EmptyState title="No institutions match" icon={<Building2 size={20} />}>Try a shorter name, a city, or the Permanent ID.</EmptyState> : (
        <Table caption="Institutions" head={["Institution", "Region", "Open / total", "Units involved", "Oldest open", "Approval"]}>
          {data.items.map((i) => (
            <tr key={i.id} onClick={rowClick(() => router.push(`/institutions/${i.permanent_id}`))} className="cursor-pointer hover:bg-action-soft/40">
              <td>
                <Link className="font-semibold text-action-ink hover:underline" href={`/institutions/${i.permanent_id}`}>{i.name}</Link>
                <p className="text-xs text-muted">{i.city}, {i.state} · <span className="font-mono">{i.permanent_id}</span></p>
              </td>
              <td>{i.region_code}</td>
              <td className="tabular"><b>{i.open_cases}</b> <span className="text-xs text-muted">/ {i.total_cases}</span></td>
              <td><span className="flex flex-wrap gap-1">{i.units.map((u) => <Badge key={u} tone={i.units_involved >= 2 ? "coord" : "neutral"}>{u}</Badge>)}</span></td>
              <td className="tabular">{fmtDate(i.oldest_open)}</td>
              <td>{i.approval_status === "APPROVED" ? <Badge tone="ok">Approved</Badge> : <Badge tone="danger">{i.approval_status.toLowerCase()}</Badge>}</td>
            </tr>
          ))}
        </Table>
      ))}
      {data && !q && multi && <p className="text-xs text-muted">Showing institutions with open matters in two or more units. Clear “Matters in 2+ units” to see all.</p>}
    </div>
  );
}

export default function InstitutionsPage() {
  return <Require cap="institutions.view"><Suspense fallback={<TableSkeleton />}><Institutions /></Suspense></Require>;
}
