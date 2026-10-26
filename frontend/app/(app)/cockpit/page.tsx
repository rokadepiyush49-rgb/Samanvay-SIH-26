"use client";

import Link from "next/link";
import { useState } from "react";
import { TileArt } from "@/components/icons";
import { Stagger, StaggerItem } from "@/components/motion";
import { Bar, Button, Card, ErrorNote, Field, Hero, Spinner, Table, Tile, inputCls } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { ago, num, pct } from "@/lib/format";
import { useSession } from "@/lib/session";

type Summary = {
  scope: { unit: string | null; region: number | null };
  as_of: string;
  tiles: { key: string; label: string; value: number; query: string }[];
  rejected_at_intake: number;
  ageing: { bucket: string; count: number }[];
  workload: { unit: string; open: number; overdue: number; "0–10": number; "11–21": number; "22–60": number; ">60": number }[];
  within_timeline: { on_time: number; disposed: number; pct: number | null; window_days: number };
  undecided_overlaps: { count: number; oldest_working_days: number | null };
  multi_unit_institutions: number;
  kpis: { consequential_actions_past_undecided_overlap: number; consequential_actions_total: number; coordination_opened_from_guard: number; median_alert_to_decision_hours: number | null };
  register_health: { unit: string; open: number; resolved_pct: number | null; assigned_pct: number | null; stale_pct: number | null; score: number | null }[];
};

type Sim = { units: { unit: string; cases: number; breaches_current: number; breaches_proposed: number }[]; totals: { cases: number; breaches_current: number; breaches_proposed: number }; note: string; period: { from: string; to: string } };

const TILE: Record<string, { tone: "yellow" | "mint" | "pink" | "sky" | "cream"; art: Parameters<typeof TileArt>[0]["kind"] }> = {
  total: { tone: "cream", art: "stack" }, pending: { tone: "yellow", art: "inbox" }, under_process: { tone: "sky", art: "clock" },
  disposed: { tone: "mint", art: "check" }, transferred: { tone: "pink", art: "transfer" }, escalated: { tone: "pink", art: "alert" },
  overdue: { tone: "yellow", art: "alert" },
};

function Simulator() {
  const [target, setTarget] = useState(21);
  const [basis, setBasis] = useState<"CALENDAR" | "WORKING">("CALENDAR");
  const [channel, setChannel] = useState("CPGRAMS");
  const [out, setOut] = useState<Sim | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setOut(await api<Sim>("/simulations/sla", { json: { target_days: target, day_basis: basis, channel: channel || null } }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const max = Math.max(1, ...(out?.units ?? []).map((u) => Math.max(u.breaches_current, u.breaches_proposed)));
  return (
    <Card tone="cream">
      <h2 className="text-lg font-extrabold">SLA what-if simulator</h2>
      <p className="text-sm text-muted">Replays the last 90 days of cases under a proposed timeline. A replay of history, not a forecast.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_160px_auto] sm:items-end">
        <Field label={`Target: ${target} ${basis === "WORKING" ? "working" : "calendar"} days`}>
          <input type="range" min={5} max={90} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="accent-[var(--navy)]" />
        </Field>
        <Field label="Day basis"><select className={inputCls} value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}><option value="CALENDAR">Calendar</option><option value="WORKING">Working</option></select></Field>
        <Field label="Channel"><select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">All</option><option value="CPGRAMS">CPGRAMS</option><option value="EMAIL">E-mail</option><option value="LETTER">Letter</option></select></Field>
        <Button busy={busy} onClick={run}>Replay</Button>
      </div>
      <ErrorNote error={error} />
      {out && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm"><b className="tabular">{num(out.totals.cases)}</b> cases · breaches today <b className="tabular">{num(out.totals.breaches_current)}</b> → under proposal <b className="tabular">{num(out.totals.breaches_proposed)}</b></p>
          <ul className="flex flex-col gap-2">
            {out.units.map((u) => (
              <li key={u.unit} className="grid grid-cols-[64px_minmax(0,1fr)_90px] items-center gap-3 text-sm">
                <span className="font-bold">{u.unit}</span>
                <span className="flex flex-col gap-1"><Bar value={u.breaches_current} max={max} tone="sky" /><Bar value={u.breaches_proposed} max={max} tone="pink" /></span>
                <span className="text-right text-xs tabular">{u.breaches_current} → {u.breaches_proposed}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted"><span className="inline-block h-2 w-3 rounded bg-sky" /> current policy · <span className="inline-block h-2 w-3 rounded bg-pink" /> proposed · {out.note}</p>
        </div>
      )}
    </Card>
  );
}

export default function CockpitPage() {
  const { me } = useSession();
  const { data, error, isLoading, mutate } = useApi<Summary>("/dashboard/summary", { refreshInterval: 30000 });
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} onRetry={() => mutate()} />;
  const scope = data.scope.unit ? `${data.scope.unit} unit` : data.scope.region ? `Region ${data.scope.region}` : "All units";
  const maxAge = Math.max(1, ...data.ageing.map((a) => a.count));
  const maxOpen = Math.max(1, ...data.workload.map((w) => w.open));
  const k = data.kpis;
  return (
    <div className="flex flex-col gap-6">
      <Hero kicker={`Management Cockpit · ${scope}`} title={<>Real-time case ledger</>}
        side={<p className="rounded-full bg-navy-2 px-4 py-2 text-xs font-semibold">Live · updated {ago(data.as_of)} · refreshes every 30 s</p>}>
        Every number is computed from the live ledger and drills down to the exact cases behind it. Sealed categories are excluded unless you are cleared.
      </Hero>

      <Stagger className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {data.tiles.map((t) => (
          <StaggerItem key={t.key} className="h-full">
            <Tile tone={TILE[t.key]?.tone ?? "cream"} title={t.label} value={num(t.value)} href={`/cases?${t.query}`} art={<TileArt kind={TILE[t.key]?.art ?? "stack"} />} />
          </StaggerItem>
        ))}
      </Stagger>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card tone="pink">
          <p className="text-sm font-bold">Undecided overlaps</p>
          <p className="mt-1 text-4xl font-extrabold tabular">{data.undecided_overlaps.count}</p>
          <p className="text-xs">oldest {data.undecided_overlaps.oldest_working_days ?? 0} working days · <Link href="/coordination" className="font-bold underline">open centre</Link></p>
        </Card>
        <Card tone="mint">
          <p className="text-sm font-bold">Disposed within timeline</p>
          <p className="mt-1 text-4xl font-extrabold tabular">{pct(data.within_timeline.pct)}</p>
          <p className="text-xs">{data.within_timeline.on_time} of {data.within_timeline.disposed} disposals, last {data.within_timeline.window_days} days</p>
        </Card>
        <Card tone="sky">
          <p className="text-sm font-bold">Institutions with matters in 2+ units</p>
          <p className="mt-1 text-4xl font-extrabold tabular">{data.multi_unit_institutions}</p>
          <p className="text-xs"><Link href="/institutions" className="font-bold underline">see list</Link></p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="font-bold">Pending-case ageing (working days)</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {data.ageing.map((a) => (
              <li key={a.bucket} className="grid grid-cols-[70px_minmax(0,1fr)_60px] items-center gap-3 text-sm">
                <span className="font-semibold">{a.bucket}</span><Bar value={a.count} max={maxAge} tone={a.bucket === ">60" ? "pink" : "sky"} /><span className="text-right tabular">{num(a.count)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="font-bold">Bureau / Cell workload</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {data.workload.map((w) => (
              <li key={w.unit} className="grid grid-cols-[70px_minmax(0,1fr)_110px] items-center gap-3 text-sm">
                <Link href={`/cases?unit=${w.unit}&open_only=true`} className="font-bold hover:underline">{w.unit}</Link>
                <Bar value={w.open} max={maxOpen} tone="navy" />
                <span className="text-right text-xs tabular">{w.open} open · <span className="font-bold text-danger">{w.overdue} overdue</span></span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="font-bold">Coordination KPIs (last 90 days)</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-xs text-muted">Consequential actions</dt><dd className="text-2xl font-extrabold tabular">{k.consequential_actions_total}</dd></div>
            <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-xs text-muted">…taken past an undecided overlap</dt><dd className="text-2xl font-extrabold tabular">{k.consequential_actions_past_undecided_overlap}</dd></div>
            <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-xs text-muted">Guard → “coordinate first”</dt><dd className="text-2xl font-extrabold tabular">{k.coordination_opened_from_guard}</dd></div>
            <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-xs text-muted">Median alert → decision</dt><dd className="text-2xl font-extrabold tabular">{k.median_alert_to_decision_hours ?? "—"}<span className="text-sm"> h</span></dd></div>
          </dl>
        </Card>
        <Card>
          <h2 className="font-bold">Register health</h2>
          <p className="text-xs text-muted">Share of open cases with a confirmed institution, an assigned officer, and activity in the last 30 days.</p>
          <div className="mt-3">
            <Table head={["Unit", "Open", "Resolved", "Assigned", "Stale", "Score"]}>
              {data.register_health.map((h) => (
                <tr key={h.unit}><td className="font-bold">{h.unit}</td><td className="tabular">{h.open}</td><td>{pct(h.resolved_pct)}</td><td>{pct(h.assigned_pct)}</td><td>{pct(h.stale_pct)}</td><td className="font-bold">{h.score ?? "—"}</td></tr>
              ))}
            </Table>
          </div>
        </Card>
      </div>

      {me && <Simulator />}
    </div>
  );
}
