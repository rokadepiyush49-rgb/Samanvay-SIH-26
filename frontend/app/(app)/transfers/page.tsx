"use client";

import { ArrowLeftRight, ArrowRight, CheckCircle2, Undo2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { TransferDecisionDialog } from "@/components/case-dialogs";
import { Require } from "@/components/require";
import { TransferStatusBadge } from "@/components/status";
import { useToast } from "@/components/toast";
import { Button, Card, EmptyState, ErrorNote, PageHeader, TableSkeleton, Tabs } from "@/components/ui";
import { qs, revalidate, useApi } from "@/lib/api";
import { ago, fmtDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Transfer } from "@/lib/types";

type View = "incoming" | "outgoing" | "history";
const QUERY: Record<View, { direction: string; state: string }> = {
  incoming: { direction: "incoming", state: "open" },
  outgoing: { direction: "outgoing", state: "open" },
  history: { direction: "all", state: "closed" },
};
const EMPTY: Record<View, string> = {
  incoming: "No transfers are waiting for your unit to accept.",
  outgoing: "Your unit has no transfers waiting on another unit.",
  history: "No accepted or returned transfers yet.",
};

function TransferRow({ t, onDecide }: { t: Transfer; onDecide: (t: Transfer, m: "accept" | "return") => void }) {
  return (
    <li className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_200px_auto] lg:items-center" data-testid="transfer-row">
      <div className="min-w-0">
        <Link href={`/cases/${t.case_no}`} className="font-mono text-sm font-semibold text-action-ink hover:underline">{t.case_no}</Link>
        <p className="truncate text-sm">{t.institution?.name ?? "Institution unconfirmed"}</p>
        <p className="truncate text-xs text-muted">{t.category}</p>
      </div>
      <div className="min-w-0 text-sm">
        <p className="flex items-center gap-2 font-semibold"><span>{t.from_unit}</span><ArrowRight size={14} className="text-muted" aria-label="to" /><span>{t.to_unit}</span></p>
        <p className="text-xs text-muted">Proposed by {t.proposed_by} · <time dateTime={t.proposed_at} title={fmtDateTime(t.proposed_at)}>{ago(t.proposed_at)}</time></p>
        {t.reason ? <p className="mt-1 line-clamp-2 text-xs">“{t.reason}”</p> : <p className="mt-1 text-xs italic text-muted">Reason visible to the two units involved</p>}
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <TransferStatusBadge status={t.status} />
        <span className="text-muted">Custodian now: <b className="text-ink" data-testid="transfer-custodian">{t.holding_unit}</b></span>
        {t.decided_at && <span className="text-muted">{t.status === "ACCEPTED" ? "Accepted" : "Returned"} by {t.decided_by} · {fmtDateTime(t.decided_at)}</span>}
        {t.decision_remarks && <span className="line-clamp-2 text-muted">“{t.decision_remarks}”</span>}
      </div>
      <div className="flex gap-2 lg:justify-end">
        {t.can_decide ? (
          <>
            <Button size="sm" onClick={() => onDecide(t, "accept")} icon={<CheckCircle2 size={14} aria-hidden />}>Accept</Button>
            <Button size="sm" variant="secondary" onClick={() => onDecide(t, "return")} icon={<Undo2 size={14} aria-hidden />}>Return</Button>
          </>
        ) : <Link href={`/cases/${t.case_no}`} className="text-xs font-medium text-action hover:underline">Open case</Link>}
      </div>
    </li>
  );
}

function Transfers() {
  const { t: tr } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const toast = useToast();
  const view = (["incoming", "outgoing", "history"].includes(sp.get("view") ?? "") ? sp.get("view") : "incoming") as View;
  const { data, error, isLoading, mutate } = useApi<{ items: Transfer[]; as_of: string }>(`/transfers${qs({ ...QUERY[view], limit: 100 })}`, { refreshInterval: 30000 });
  const { data: inc } = useApi<{ items: Transfer[] }>("/transfers?direction=incoming&state=open&limit=100");
  const { data: out } = useApi<{ items: Transfer[] }>("/transfers?direction=outgoing&state=open&limit=100");
  const [decide, setDecide] = useState<{ t: Transfer; mode: "accept" | "return" } | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={tr("nav.transfers")} crumbs={[{ label: tr("group.workspace") }, { label: tr("nav.transfers") }]}
        description="Custody handshake between units. A transfer is complete only when the receiving unit accepts it; until then the sending unit stays responsible for the case." />
      <Card padded={false}>
        <div className="px-5 pt-2">
          <Tabs idBase="tr" label="Transfer lists" value={view} onChange={(v) => router.replace(`${pathname}?view=${v}`, { scroll: false })} items={[
            { value: "incoming", label: "Incoming — to accept", count: inc?.items.length, icon: <ArrowLeftRight size={15} aria-hidden /> },
            { value: "outgoing", label: "Outgoing — awaiting other unit", count: out?.items.length },
            { value: "history", label: "History" },
          ]} />
        </div>
        <div role="tabpanel" id={`tr-panel-${view}`} aria-labelledby={`tr-tab-${view}`} className="border-t border-rule">
          {isLoading && <div className="p-4"><TableSkeleton rows={4} /></div>}
          {error && <div className="p-4"><ErrorNote error={error} onRetry={() => mutate()} /></div>}
          {data && (data.items.length === 0
            ? <div className="p-5"><EmptyState title={EMPTY[view]} icon={<ArrowLeftRight size={20} />} /></div>
            : <ul className="divide-y divide-rule">{data.items.map((t) => <TransferRow key={t.id} t={t} onDecide={(x, mode) => setDecide({ t: x, mode })} />)}</ul>)}
        </div>
      </Card>
      <p className="text-xs text-muted">Reminder to the receiving unit after 2 working days; escalation to its head after 5. {data && `Updated ${ago(data.as_of)}.`}</p>
      {decide && (
        <TransferDecisionDialog mode={decide.mode} transfer={decide.t} onClose={() => setDecide(null)}
          onDone={(msg) => { setDecide(null); toast({ kind: "success", title: msg }); revalidate("/transfers", "/dashboard", "/cases"); }} />
      )}
    </div>
  );
}

export default function TransfersPage() {
  return <Require cap="transfers.view"><Suspense fallback={<TableSkeleton />}><Transfers /></Suspense></Require>;
}
