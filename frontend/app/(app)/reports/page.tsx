"use client";

import { useState } from "react";
import { Stagger, StaggerItem } from "@/components/motion";
import { Badge, Button, Card, ErrorNote, Field, PageHead, Spinner, Table, inputCls } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

type Spec = { code: string; title: string; description: string; period: boolean };
type Snapshot = { id: string; report_code: string; title: string; cut_off: string; checksum: string; created_at: string; scope: Record<string, unknown>; checksum_verified?: boolean;
  data?: { columns: string[]; rows: (string | number | null)[][]; totals?: (string | number | null)[]; notes?: string[]; period?: { label: string } } };

const TONES = ["bg-yellow text-yellow-ink", "bg-mint text-mint-ink", "bg-pink text-pink-ink", "bg-sky text-sky-ink"];

export default function ReportsPage() {
  const { data: cat } = useApi<{ items: Spec[] }>("/reports/catalogue");
  const { data: snaps, mutate } = useApi<{ items: Snapshot[] }>("/reports");
  const [period, setPeriod] = useState<"month" | "quarter">("month");
  const [anchor, setAnchor] = useState(new Date().toISOString().slice(0, 10));
  const [view, setView] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const generate = async (s: Spec) => {
    setBusy(s.code);
    setError(null);
    try {
      const snap = await api<Snapshot>("/reports", { json: { report_code: s.code, ...(s.period ? { period, anchor } : {}) } });
      setView({ ...snap, checksum_verified: true });
      mutate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const open = async (id: string) => setView(await api<Snapshot>(`/reports/${id}`));

  return (
    <div className="flex flex-col gap-5">
      <PageHead title="Reports">
        Each report is computed once into a frozen snapshot with a SHA-256 checksum, so the numbers discussed in a meeting can be reproduced exactly afterwards.
      </PageHead>
      <Card tone="cream" className="grid gap-3 sm:grid-cols-[180px_200px] sm:items-end">
        <Field label="Period (for period reports)"><select className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}><option value="month">Month</option><option value="quarter">Quarter</option></select></Field>
        <Field label="Containing date"><input type="date" className={inputCls} value={anchor} onChange={(e) => setAnchor(e.target.value)} /></Field>
      </Card>
      <ErrorNote error={error} />
      {!cat ? <Spinner /> : (
        <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cat.items.map((s, i) => (
            <StaggerItem key={s.code} className="h-full">
              <div className={`flex h-full flex-col justify-between gap-4 rounded-3xl p-5 ${TONES[i % TONES.length]}`}>
                <div><p className="font-extrabold leading-tight">{s.title}</p><p className="mt-1 text-xs opacity-80">{s.description}</p></div>
                <Button onClick={() => generate(s)} busy={busy === s.code} arrow>Generate</Button>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      )}

      {view?.data && (
        <Card>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-extrabold">{view.title}</h2>
              <p className="text-xs text-muted">Cut-off {fmtDateTime(view.cut_off)} · scope {JSON.stringify(view.scope).replace(/[{}"]/g, "").replaceAll(",", ", ") || "all units"}</p>
              <p className="mt-1 break-all font-mono text-[11px] text-muted">SHA-256 {view.checksum} {view.checksum_verified && <Badge tone="ok">✓ verified</Badge>}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["xlsx", "pdf", "csv"] as const).map((f) => <a key={f} href={`/api/v1/reports/${view.id}/download?fmt=${f}`} className="rounded-full bg-navy px-4 py-2 text-xs font-bold uppercase text-white">{f}</a>)}
            </div>
          </div>
          <div className="mt-4">
            <Table head={view.data.columns}>
              {view.data.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j ? "tabular" : "font-semibold"}>{v ?? "—"}</td>)}</tr>)}
              {view.data.totals && view.data.totals.length > 0 && <tr className="bg-surface-2 font-bold">{view.data.totals.map((v, j) => <td key={j} className="tabular">{v ?? ""}</td>)}</tr>}
            </Table>
          </div>
          {view.data.notes?.map((n) => <p key={n} className="mt-2 text-xs text-muted">{n}</p>)}
        </Card>
      )}

      <h2 className="text-lg font-extrabold">Snapshots</h2>
      {!snaps ? <Spinner /> : (
        <Table head={["Report", "Cut-off", "Checksum", ""]}>
          {snaps.items.map((s) => (
            <tr key={s.id}>
              <td className="font-semibold">{s.title}</td>
              <td>{fmtDateTime(s.cut_off)}</td>
              <td className="font-mono text-[11px] text-muted">{s.checksum.slice(0, 20)}…</td>
              <td><button className="text-sm font-bold underline" onClick={() => open(s.id)}>Open</button></td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
