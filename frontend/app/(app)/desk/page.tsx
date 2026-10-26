"use client";

import Link from "next/link";
import { CaseTable } from "@/components/cases";
import { TileArt } from "@/components/icons";
import { Button, Card, Empty, ErrorNote, Hero, PillLink, Spinner, Tile, TypeBadge } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { ago, fmtDate } from "@/lib/format";
import { hasRole, useSession } from "@/lib/session";
import type { CaseRow } from "@/lib/types";

type Desk = {
  as_of: string;
  scope: "unit" | "mine";
  worklist: CaseRow[];
  worklist_total: number;
  due_this_week: number;
  overdue: number;
  transfers_awaiting: { id: string; case_no: string; from_unit: string; proposed_at: string; category: string }[];
  coordination_open: { code: string; status: string; type: string; decide_by: string; cases: string[] }[];
  unresolved_institutions: number;
};

export default function DeskPage() {
  const { me } = useSession();
  const { data, error, mutate, isLoading } = useApi<Desk>("/dashboard/desk", { refreshInterval: 30000 });
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} onRetry={() => mutate()} />;
  const canIntake = hasRole(me, "INTAKE_OFFICER", "CASE_OFFICER", "UNIT_HEAD", "REGIONAL_OFFICER");
  const accept = async (id: string) => {
    await api(`/transfers/${id}/accept`, { json: {} });
    mutate();
  };
  return (
    <div className="flex flex-col gap-6">
      <Hero kicker={`${me?.unit.name} · ${data.scope === "unit" ? "unit worklist" : "my worklist"}`}
        title={<>Bureau Desk</>}
        side={canIntake && <div className="flex flex-wrap gap-2"><PillLink href="/cases/new">New case</PillLink></div>}>
        Breach-first worklist. Cases marked <b className="text-pink">Coordination required</b> have an open matter in another unit.
      </Hero>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile tone="yellow" title="Open on my desk" value={data.worklist_total} hint="sorted by due date" art={<TileArt kind="inbox" />} />
        <Tile tone="pink" title="Overdue" value={data.overdue} hint="past expected disposal" art={<TileArt kind="alert" />} href={`/cases?unit=${me?.unit.code}&overdue=true`} />
        <Tile tone="sky" title="Due this week" value={data.due_this_week} hint="within 7 days" art={<TileArt kind="clock" />} />
        <Tile tone="mint" title="Overlaps to decide" value={data.coordination_open.length} hint="coordination cards" art={<TileArt kind="link" />} href="/coordination" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-extrabold">Worklist</h2>
            <span className="text-xs text-muted">updated {ago(data.as_of)}</span>
          </div>
          {data.worklist.length === 0 ? (
            <Empty title="No cases assigned.">New cases from your unit appear here. <Link className="font-semibold underline" href="/imports">Import a register</Link> to load existing files.</Empty>
          ) : <CaseTable rows={data.worklist} showUnit={false} />}
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <h3 className="font-bold">Transfers awaiting acceptance</h3>
            {data.transfers_awaiting.length === 0 ? <p className="mt-2 text-sm text-muted">None.</p> : (
              <ul className="mt-3 flex flex-col gap-3">
                {data.transfers_awaiting.map((t) => (
                  <li key={t.id} className="rounded-2xl bg-cream p-3 text-sm">
                    <Link href={`/cases/${t.case_no}`} className="font-mono font-bold underline-offset-2 hover:underline">{t.case_no}</Link>
                    <p className="text-xs text-muted">from {t.from_unit} · {t.category} · {ago(t.proposed_at)}</p>
                    {hasRole(me, "CASE_OFFICER", "UNIT_HEAD", "REGIONAL_OFFICER") && (
                      <div className="mt-2 flex gap-2"><Button onClick={() => accept(t.id)}>Accept</Button><Link href={`/cases/${t.case_no}`} className="self-center text-xs font-semibold underline">Review first</Link></div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h3 className="font-bold">Open coordination</h3>
            {data.coordination_open.length === 0 ? <p className="mt-2 text-sm text-muted">No overlaps need a decision.</p> : (
              <ul className="mt-3 flex flex-col gap-2">
                {data.coordination_open.slice(0, 8).map((c) => (
                  <li key={c.code}>
                    <Link href={`/coordination/${c.code}`} className="flex items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-sm hover:bg-rule/60">
                      <span><span className="font-mono font-bold">{c.code}</span><span className="block text-xs text-muted">{c.cases.join(" ↔ ")}</span></span>
                      <span className="flex flex-col items-end gap-1"><TypeBadge type={c.type} /><span className="text-[11px] text-muted">by {fmtDate(c.decide_by)}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {data.unresolved_institutions > 0 && (
            <Card tone="yellow">
              <h3 className="font-bold">{data.unresolved_institutions} cases need an institution</h3>
              <p className="mt-1 text-sm">The resolver was not confident. Confirm the institution so overlap matching can run.</p>
              <Link className="mt-2 inline-block text-sm font-bold underline" href={`/cases?unit=${me?.unit.code}&resolution=PENDING&open_only=true`}>Open the queue</Link>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
