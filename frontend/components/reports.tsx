"use client";

import { Download, FileSpreadsheet, ShieldCheck, ShieldX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { ReportSnapshot, ReportSpec } from "@/lib/types";
import { useToast } from "./toast";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Table, TableSkeleton, buttonCls, inputCls, rowClick } from "./ui";

export function scopeText(scope: Record<string, unknown> | undefined): string {
  if (!scope) return "All units";
  const parts = Object.entries(scope).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k} ${v}`);
  return parts.length ? parts.join(", ") : "All units";
}

export function CatalogueView() {
  const router = useRouter();
  const toast = useToast();
  const { data: cat, error: catError } = useApi<{ items: ReportSpec[] }>("/reports/catalogue");
  const [period, setPeriod] = useState<"month" | "quarter">("month");
  const [anchor, setAnchor] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const generate = async (s: ReportSpec) => {
    setBusy(s.code);
    setError(null);
    try {
      const snap = await api<ReportSnapshot>("/reports", { json: { report_code: s.code, ...(s.period ? { period, anchor } : {}) } });
      toast({ kind: "success", title: `${snap.title} generated`, detail: `Frozen at ${fmtDateTime(snap.cut_off)} · SHA-256 ${snap.checksum.slice(0, 12)}…` });
      router.push(`/reports/snapshots/${snap.id}`);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <Card title="Reporting period" description="Applies to the period reports (disposal rate, monthly / quarterly performance). Other reports are as of the moment you generate them.">
        <div className="grid gap-3 sm:grid-cols-[180px_200px]">
          <Field id="r-period" label="Period"><select id="r-period" className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}><option value="month">Month</option><option value="quarter">Quarter</option></select></Field>
          <Field id="r-anchor" label="Containing date"><input id="r-anchor" type="date" className={inputCls} value={anchor} onChange={(e) => setAnchor(e.target.value)} /></Field>
        </div>
      </Card>
      <ErrorNote error={error ?? catError} />
      {!cat ? <TableSkeleton rows={4} /> : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cat.items.map((s) => (
            <li key={s.code} className="flex flex-col justify-between gap-4 rounded-xl border border-rule bg-surface p-4 shadow-card">
              <div>
                <span className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-action-soft text-action" aria-hidden><FileSpreadsheet size={18} /></span>
                <p className="font-semibold leading-snug">{s.title}</p>
                <p className="mt-1 text-xs text-muted">{s.description}</p>
                {s.period && <Badge className="mt-2" tone="info">Period: {period}</Badge>}
              </div>
              <Button variant="secondary" onClick={() => generate(s)} busy={busy === s.code}>Generate frozen report</Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">Scope follows your role: unit heads get their unit, regional officers their region, senior management all units.</p>
    </div>
  );
}

export function SnapshotList() {
  const router = useRouter();
  const { data, error, mutate } = useApi<{ items: ReportSnapshot[] }>("/reports");
  if (error) return <ErrorNote error={error} onRetry={() => mutate()} />;
  if (!data) return <TableSkeleton rows={6} />;
  if (data.items.length === 0) return <EmptyState title="No frozen reports yet" action={<Link className={buttonCls("secondary")} href="/reports/catalogue">Open the report catalogue</Link>}>Generate one from the catalogue; it appears here with its checksum.</EmptyState>;
  return (
    <Table caption="Frozen report snapshots" head={["Report", "Scope", "Generated (cut-off)", "Checksum", ""]} minWidth={680}>
      {data.items.map((s) => (
        <tr key={s.id} onClick={rowClick(() => router.push(`/reports/snapshots/${s.id}`))} className="cursor-pointer hover:bg-action-soft/40">
          <td><Link href={`/reports/snapshots/${s.id}`} className="font-semibold text-action-ink hover:underline">{s.title}</Link></td>
          <td className="text-xs">{scopeText(s.scope)}</td>
          <td className="whitespace-nowrap tabular">{fmtDateTime(s.cut_off)}</td>
          <td className="font-mono text-[11px] text-muted">{s.checksum.slice(0, 16)}…</td>
          <td className="text-right text-xs font-medium text-action">Open</td>
        </tr>
      ))}
    </Table>
  );
}

export function SnapshotView({ id }: { id: string }) {
  const { data: s, error, mutate } = useApi<ReportSnapshot>(`/reports/${id}`);
  if (error) return <ErrorNote error={error} onRetry={() => mutate()} />;
  if (!s) return <TableSkeleton rows={8} />;
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{s.title}</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Scope</dt><dd>{scopeText(s.scope)}</dd>
              <dt className="text-muted">Generated</dt><dd className="tabular">{fmtDateTime(s.cut_off)} (data frozen at this cut-off)</dd>
              {s.data?.period && <><dt className="text-muted">Period</dt><dd>{s.data.period.label}</dd></>}
              <dt className="text-muted">SHA-256</dt><dd className="break-all font-mono text-[11px]">{s.checksum}</dd>
            </dl>
            <p className="mt-2">{s.checksum_verified
              ? <Badge tone="ok" icon={<ShieldCheck size={12} aria-hidden />}>Checksum verified — numbers unchanged since generation</Badge>
              : <Badge tone="danger" icon={<ShieldX size={12} aria-hidden />}>Checksum mismatch — do not rely on this snapshot</Badge>}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["xlsx", "pdf", "csv"] as const).map((f) => (
              <a key={f} href={`/api/v1/reports/${s.id}/download?fmt=${f}`} className={buttonCls("secondary", "sm")}><Download size={14} aria-hidden />{f.toUpperCase()}</a>
            ))}
          </div>
        </div>
      </Card>
      {s.data && (
        <Table caption={s.title} head={s.data.columns} minWidth={560}>
          {s.data.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j ? "tabular" : "font-medium"}>{v ?? "—"}</td>)}</tr>)}
          {s.data.totals && s.data.totals.length > 0 && <tr className="bg-surface-2 font-semibold">{s.data.totals.map((v, j) => <td key={j} className="tabular">{v ?? ""}</td>)}</tr>}
        </Table>
      )}
      {s.data?.notes?.map((n) => <p key={n} className="text-xs text-muted">{n}</p>)}
    </div>
  );
}
