"use client";

import { LifeBuoy } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Require } from "@/components/require";
import { AssistanceItem, AssistanceReplyDialog } from "@/components/routing";
import { useToast } from "@/components/toast";
import { Card, EmptyState, ErrorNote, KpiCard, PageHeader, TableSkeleton, Tabs } from "@/components/ui";
import { qs, revalidate, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { AssistanceList, AssistanceRequest } from "@/lib/types";

type View = "incoming" | "outgoing" | "history";
const QUERY: Record<View, { direction: string; state: string }> = {
  incoming: { direction: "incoming", state: "open" },
  outgoing: { direction: "outgoing", state: "open" },
  history: { direction: "all", state: "closed" },
};
const EMPTY: Record<View, string> = {
  incoming: "No other unit is waiting on your unit for assistance.",
  outgoing: "Your unit has no open requests with other units.",
  history: "No completed, declined or withdrawn requests yet.",
};

function Assistance() {
  const { t } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const toast = useToast();
  const view = (["incoming", "outgoing", "history"].includes(sp.get("view") ?? "") ? sp.get("view") : "incoming") as View;
  const { data, error, isLoading, mutate } = useApi<AssistanceList>(`/assistance${qs({ ...QUERY[view], limit: 100 })}`, { refreshInterval: 30000 });
  const [reply, setReply] = useState<{ a: AssistanceRequest; mode: "accept" | "decline" | "complete" | "cancel" } | null>(null);
  const counts = data?.counts;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("nav.assistance")} crumbs={[{ label: t("group.workspace") }, { label: t("nav.assistance") }]}
        description="One unit asks another for a verification visit, records, an opinion or an action. The asking unit keeps the case; the other unit can read it only while the request is open." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Awaiting your acknowledgement" value={counts?.awaiting_ack ?? "—"} tone={counts?.awaiting_ack ? "warn" : "neutral"} hint="reminder after 2 working days" />
        <KpiCard label="Open — asked of your unit" value={counts?.incoming_open ?? "—"} tone="info" />
        <KpiCard label="Open — your unit asked" value={counts?.outgoing_open ?? "—"} tone="neutral" />
        <KpiCard label="Overdue" value={counts?.overdue ?? "—"} tone={counts?.overdue ? "danger" : "neutral"} hint="escalated to both unit heads" />
      </div>
      <Card padded={false}>
        <div className="px-5 pt-2">
          <Tabs idBase="as" label="Assistance lists" value={view} onChange={(v) => router.replace(`${pathname}?view=${v}`, { scroll: false })} items={[
            { value: "incoming", label: "Asked of my unit", count: counts?.incoming_open, icon: <LifeBuoy size={15} aria-hidden /> },
            { value: "outgoing", label: "My unit asked", count: counts?.outgoing_open },
            { value: "history", label: "History" },
          ]} />
        </div>
        <div role="tabpanel" id={`as-panel-${view}`} aria-labelledby={`as-tab-${view}`} className="border-t border-rule">
          {isLoading && <div className="p-4"><TableSkeleton rows={4} /></div>}
          {error && <div className="p-4"><ErrorNote error={error} onRetry={() => mutate()} /></div>}
          {data && (data.items.length === 0
            ? <div className="p-5"><EmptyState title={EMPTY[view]} icon={<LifeBuoy size={20} />} /></div>
            : <ul className="divide-y divide-rule">{data.items.map((a) => <AssistanceItem key={a.id} a={a} showCase onReply={(x, mode) => setReply({ a: x, mode })} />)}</ul>)}
        </div>
      </Card>
      {reply && (
        <AssistanceReplyDialog req={reply.a} mode={reply.mode} onClose={() => setReply(null)}
          onDone={(msg) => { setReply(null); toast({ kind: "success", title: msg }); revalidate("/assistance", "/cases"); }} />
      )}
    </div>
  );
}

export default function AssistancePage() {
  return <Require cap="assistance.view"><Suspense fallback={<TableSkeleton />}><Assistance /></Suspense></Require>;
}
