"use client";

import { Flag, Network, TrendingUp } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CoordinationRow } from "@/components/coordination";
import { Require } from "@/components/require";
import { Card, EmptyState, ErrorNote, KpiCard, PageHeader, TableSkeleton, Tabs, cx } from "@/components/ui";
import { qs, useApi } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import type { CoordinationList } from "@/lib/types";

type Status = "open" | "awaiting" | "escalated" | "decided" | "all";

function Centre() {
  const { me, t } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const status = (["open", "awaiting", "escalated", "decided", "all"].includes(sp.get("status") ?? "") ? sp.get("status") : "open") as Status;
  const oversight = can(me, "oversight.all_units");
  const mine = !oversight || sp.get("mine") === "1";
  const apiStatus = status === "awaiting" ? "open" : status;
  const { data, error, isLoading, mutate } = useApi<CoordinationList>(`/coordination${qs({ status: apiStatus, mine: mine || undefined, limit: 200 })}`, { refreshInterval: 30000 });
  const items = (data?.items ?? []).filter((c) => status !== "awaiting" || c.awaiting_me);
  const set = (patch: Record<string, string | undefined>) => router.replace(`${pathname}${qs({ status, mine: mine && oversight ? "1" : undefined, ...patch })}`, { scroll: false });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("nav.coordination")} crumbs={[{ label: t("group.workspace") }, { label: t("nav.coordination") }]}
        description="Potential Overlapping Cases – Coordination Required. Each item pairs two cases about the same institution with the evidence behind the match. One unit proposes a decision; the other confirms. Similarity is evidence for review, never an automatic merge." />

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Awaiting your confirmation" value={data?.counts.awaiting_me ?? "—"} icon={<Flag size={18} />} tone="danger" hint="proposed by the other unit" />
        <KpiCard label="Parallel-action overlaps" value={data?.counts.parallel ?? "—"} icon={<Network size={18} />} tone="coord" hint="two units acting on one institution" />
        <KpiCard label="Escalated" value={data?.counts.escalated ?? "—"} icon={<TrendingUp size={18} />} tone="warn" hint="undecided for 3+ working days" />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-2">
          <Tabs idBase="co" label="Coordination status" value={status} onChange={(v) => set({ status: v })} items={[
            { value: "open", label: "Needs decision" },
            { value: "awaiting", label: "Awaiting me", count: data?.counts.awaiting_me },
            { value: "escalated", label: "Escalated" },
            { value: "decided", label: "Decided" },
            { value: "all", label: "All" },
          ]} />
          {oversight && (
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={mine} onChange={(e) => set({ mine: e.target.checked ? "1" : undefined })} className="h-4 w-4 accent-[var(--action)]" />
              Only cards involving {me.unit.code}
            </label>
          )}
        </div>
        <div role="tabpanel" id={`co-panel-${status}`} aria-labelledby={`co-tab-${status}`} className={cx("border-t border-rule", !isLoading && "min-h-24")}>
          {isLoading && <div className="p-4"><TableSkeleton rows={5} /></div>}
          {error && <div className="p-4"><ErrorNote error={error} onRetry={() => mutate()} /></div>}
          {data && (items.length === 0 ? (
            <div className="p-5"><EmptyState title={status === "decided" ? "No decided cards yet" : "No overlaps need a decision"} icon={<Network size={20} />}>
              {status === "awaiting" ? "Nothing is waiting for your unit's confirmation." : "When the overlap engine links cases across units, they appear here."}
            </EmptyState></div>
          ) : (
            <ul className="divide-y divide-rule">{items.map((c) => <CoordinationRow key={c.id} c={c} />)}</ul>
          ))}
        </div>
      </Card>
      {data && <p className="text-xs text-muted">Showing up to 200 cards, parallel-action first, then by decision deadline. Refreshes every 30 s.</p>}
    </div>
  );
}

export default function CoordinationPage() {
  return <Require cap="coordination.view"><Suspense fallback={<TableSkeleton />}><Centre /></Suspense></Require>;
}
