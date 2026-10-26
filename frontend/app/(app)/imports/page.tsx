"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, PageHeader, Spinner, Table, inputCls, cx } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { CHANNEL_LABEL, fmtDateTime, label } from "@/lib/format";
import type { Meta } from "@/lib/types";
import { Require } from "@/components/require";

type Preview = { header: string[]; row_count: number; sample: string[][]; column_map: Record<string, string | null>; status_map: Record<string, string | null>; category_map: Record<string, string | null>; required: string[]; fields: string[]; statuses: string[]; channels: string[] };
type Job = { id: string; filename: string; status: string; total_rows: number; created_rows: number; duplicate_rows: number; error_rows: number; created_at: string; finished_at: string | null; channel: string; errors?: { row: number; error: string }[]; overlaps_found?: number; matching_pending?: number };
type Profile = { id: string; name: string; channel: string; column_map: Record<string, string | null>; status_map: Record<string, string | null>; category_map: Record<string, string | null>; date_format: string | null; shared: boolean };

const FIELD_LABEL: Record<string, string> = {
  received_on: "Receipt date", institution_name: "Institution name", permanent_id: "Permanent ID", category: "Category", subject: "Subject", body: "Complaint text",
  source_ref: "Source reference", unit_file_no: "File no.", status: "Status", complainant_name: "Complainant", complainant_phone: "Phone", complainant_email: "E-mail",
  complainant_type: "Complainant type", city: "City", state: "State", pin: "PIN", disposed_on: "Disposal date", next_action: "Next action",
};

function Importer() {
  const { data: meta } = useApi<Meta>("/meta");
  const { data: jobs, mutate: refreshJobs } = useApi<{ items: Job[] }>("/imports");
  const { data: profiles } = useApi<{ items: Profile[] }>("/imports/profiles");
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [channel, setChannel] = useState("REGISTER");
  const [cols, setCols] = useState<Record<string, string | null>>({});
  const [statusMap, setStatusMap] = useState<Record<string, string | null>>({});
  const [catMap, setCatMap] = useState<Record<string, string | null>>({});
  const [saveAs, setSaveAs] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { data: job } = useApi<Job>(jobId ? `/imports/${jobId}` : null, { refreshInterval: (j) => (j && ["DONE", "FAILED"].includes(j.status) && !j.matching_pending ? 0 : 1500) });

  useEffect(() => { if (job && ["DONE", "FAILED"].includes(job.status)) refreshJobs(); }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = async (f: File) => {
    setFile(f); setError(null); setJobId(null);
    const form = new FormData();
    form.append("file", f);
    try {
      const p = await api<Preview>("/imports/preview", { form });
      setPv(p); setCols(p.column_map); setStatusMap(p.status_map); setCatMap(p.category_map);
    } catch (e) {
      setError(e);
      setPv(null);
    }
  };
  const applyProfile = (id: string) => {
    const p = profiles?.items.find((x) => x.id === id);
    if (!p) return;
    setChannel(p.channel); setCols({ ...cols, ...p.column_map }); setStatusMap({ ...statusMap, ...p.status_map }); setCatMap({ ...catMap, ...p.category_map });
  };
  const start = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("profile", JSON.stringify({ channel, column_map: cols, status_map: statusMap, category_map: catMap, save_as: saveAs || null }));
    try {
      const out = await api<{ id: string }>("/imports", { form });
      setJobId(out.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const missing = pv ? [...pv.required.filter((r) => !cols[r]), ...(!cols.institution_name && !cols.permanent_id ? ["institution_name or permanent_id"] : [])] : [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Register Importer" crumbs={[{ label: "Workspace" }, { label: "Register Importer" }]}
        description="Bring a unit's existing register or a CPGRAMS export into the ledger. Map the columns once, validate every row, and re-run safely: rows with the same reference are never duplicated." />
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-bold">1 · Choose a CSV or XLSX file (10 MB max)</p>
          <p className="text-xs text-muted">Samples: <code>samples/rb_register_sample.xlsx</code>, <code>samples/cpgrams_export_sample.csv</code></p>
        </div>
        <input type="file" accept=".csv,.xlsx" onChange={(e) => e.target.files?.[0] && preview(e.target.files[0])}
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-action file:px-4 file:py-2 file:font-semibold file:text-white" />
      </Card>
      <ErrorNote error={error} />

      {pv && !jobId && (
        <Card className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="font-bold">2 · Map columns <Badge tone="info">{pv.row_count} rows</Badge></p><p className="text-xs text-muted">Suggestions come from header names (string similarity). Check them before importing.</p></div>
            <div className="flex flex-wrap gap-3">
              {profiles && profiles.items.length > 0 && (
                <Field label="Apply saved profile"><select className={inputCls} defaultValue="" onChange={(e) => applyProfile(e.target.value)}><option value="">—</option>{profiles.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              )}
              <Field label="Channel"><select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}>{pv.channels.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c] ?? c}</option>)}</select></Field>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pv.fields.map((f) => (
              <Field key={f} label={FIELD_LABEL[f] ?? f} required={pv.required.includes(f)}>
                <select className={cx(inputCls, !cols[f] && pv.required.includes(f) && "border-danger")} value={cols[f] ?? ""} onChange={(e) => setCols({ ...cols, [f]: e.target.value || null })}>
                  <option value="">(not in file)</option>{pv.header.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </Field>
            ))}
          </div>
          {Object.keys(statusMap).length > 0 && (
            <div>
              <p className="font-bold">Status words → canonical status</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(statusMap).map(([k, v]) => (
                  <Field key={k} label={`“${k}”`}><select className={cx(inputCls, !v && "border-danger")} value={v ?? ""} onChange={(e) => setStatusMap({ ...statusMap, [k]: e.target.value || null })}>
                    <option value="">(unmapped: row will be rejected)</option>{pv.statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                  </select></Field>
                ))}
              </div>
            </div>
          )}
          {Object.keys(catMap).length > 0 && (
            <div>
              <p className="font-bold">Category words → category</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(catMap).map(([k, v]) => (
                  <Field key={k} label={`“${k}”`}><select className={cx(inputCls, !v && "border-danger")} value={v ?? ""} onChange={(e) => setCatMap({ ...catMap, [k]: e.target.value || null })}>
                    <option value="">(unmapped)</option>{meta?.categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select></Field>
                ))}
              </div>
            </div>
          )}
          <details className="rounded-lg bg-surface-2 p-3 text-xs"><summary className="cursor-pointer font-semibold">Sample rows</summary>
            <div className="mt-2 overflow-x-auto"><table className="text-left"><thead><tr>{pv.header.map((h) => <th key={h} className="px-2 py-1">{h}</th>)}</tr></thead>
              <tbody>{pv.sample.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="max-w-[18ch] truncate px-2 py-1">{v}</td>)}</tr>)}</tbody></table></div>
          </details>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label="Save mapping as (optional)"><input className={inputCls} value={saveAs} onChange={(e) => setSaveAs(e.target.value)} placeholder="e.g. RB register 2026" /></Field>
            <div className="flex items-center gap-3">
              {missing.length > 0 && <p className="text-xs font-semibold text-danger">Map: {missing.join(", ")}</p>}
              <Button busy={busy} disabled={missing.length > 0} onClick={start}>Import {pv.row_count} rows</Button>
            </div>
          </div>
        </Card>
      )}

      {jobId && (
        <Card className={job?.status === "FAILED" ? "border-danger/40 bg-danger-soft" : job?.status === "DONE" ? "border-ok/40 bg-ok-soft" : "border-action/40 bg-action-soft"}>
          <p className="font-bold">3 · {job ? `${label(job.status)} · ${job.filename}` : "Starting…"}</p>
          {job && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[["Rows", job.total_rows], ["Created", job.created_rows], ["Already present", job.duplicate_rows], ["Rejected", job.error_rows], ["Overlaps found", job.overlaps_found ?? 0]].map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-surface/70 p-3 text-ink"><p className="text-xs text-muted">{l}</p><p className="text-2xl font-extrabold tabular">{v}</p></div>
                ))}
              </div>
              {(job.matching_pending ?? 0) > 0 && <p className="mt-2 text-xs">Overlap matching is still running for {job.matching_pending} cases…</p>}
              {(job.errors?.length ?? 0) > 0 && (
                <div className="mt-4"><Table head={["Row", "Why it was rejected"]}>{job.errors!.map((e) => <tr key={e.row + e.error}><td className="tabular">{e.row}</td><td>{e.error}</td></tr>)}</Table></div>
              )}
              {job.status === "DONE" && <p className="mt-3 text-sm"><Link className="font-bold underline" href="/coordination">Review new overlaps</Link> · <button className="font-bold underline" onClick={() => { setJobId(null); setPv(null); setFile(null); }}>Import another file</button></p>}
            </>
          )}
        </Card>
      )}

      <h2 className="text-base font-semibold">Previous imports</h2>
      {!jobs ? <Spinner /> : jobs.items.length === 0 ? <EmptyState title="No imports yet." /> : (
        <Table head={["File", "Channel", "Status", "Created", "Present", "Rejected", "When"]}>
          {jobs.items.map((j) => (
            <tr key={j.id}><td><button className="font-semibold underline-offset-2 hover:underline" onClick={() => setJobId(j.id)}>{j.filename}</button></td><td>{CHANNEL_LABEL[j.channel] ?? j.channel}</td>
              <td><Badge tone={j.status === "DONE" ? "ok" : j.status === "FAILED" ? "danger" : "info"}>{label(j.status)}</Badge></td>
              <td className="tabular">{j.created_rows}</td><td className="tabular">{j.duplicate_rows}</td><td className="tabular">{j.error_rows}</td><td>{fmtDateTime(j.created_at)}</td></tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export default function ImportsPage() {
  return <Require cap="imports.run"><Importer /></Require>;
}
