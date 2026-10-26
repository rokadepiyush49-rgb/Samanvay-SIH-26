"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { qs, useApi } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import type { Analytics, Meta, Summary } from "@/lib/types";
import { cx, inputCls } from "@/components/ui";

/** Cockpit scope lives in the URL (?unit=&region=) so every cockpit tab and every drill-down shares it. */
export function useCockpitScope() {
  const sp = useSearchParams();
  const unit = sp.get("unit") ?? "";
  const region = sp.get("region") ?? "";
  const query = qs({ unit, region });
  return { unit, region, query };
}

export function useCockpitData() {
  const { query } = useCockpitScope();
  const summary = useApi<Summary>(`/dashboard/summary${query}`, { refreshInterval: 30000 });
  const analytics = useApi<Analytics>(`/dashboard/analytics${qs({ ...Object.fromEntries(new URLSearchParams(query)), months: 12 })}`, { refreshInterval: 60000 });
  return { summary, analytics };
}

export function scopeLabel(s: { unit: string | null; region: number | null } | undefined, meta?: Meta): string {
  if (!s) return "…";
  if (s.unit) return `${s.unit} unit`;
  if (s.region) return meta?.regions.find((r) => r.id === s.region)?.name ?? `Region ${s.region}`;
  return "All units";
}

export function ScopeFilter() {
  const { me } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { unit, region } = useCockpitScope();
  const { data: meta } = useApi<Meta>("/meta");
  if (!can(me, "oversight.all_units")) return null;
  const set = (patch: Record<string, string>) => router.replace(`${pathname}${qs({ unit, region, ...patch })}`, { scroll: false });
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Cockpit scope">
      <label htmlFor="sc-unit" className="text-xs font-medium text-muted">Scope</label>
      <select id="sc-unit" className={cx(inputCls, "w-auto py-1.5")} value={unit} onChange={(e) => set({ unit: e.target.value, region: "" })}>
        <option value="">All units</option>
        {meta?.units.map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}
      </select>
      <label htmlFor="sc-region" className="sr-only">Region</label>
      <select id="sc-region" className={cx(inputCls, "w-auto py-1.5")} value={region} onChange={(e) => set({ region: e.target.value, unit: "" })}>
        <option value="">All regions</option>
        {meta?.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </div>
  );
}
