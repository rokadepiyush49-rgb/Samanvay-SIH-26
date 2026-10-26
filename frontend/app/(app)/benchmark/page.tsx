"use client";

import { useState } from "react";
import { Badge, Bar, Button, Card, Empty, ErrorNote, Hero, Spinner, Table } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { hasRole, useSession } from "@/lib/session";

type System = { precision: number; recall: number; f1: number; predicted: number; true_positives: number; recall_by_kind: Record<string, number | null>; false_positive_rate_hard_negatives: Record<string, number | null>; pairs_with_hindi: { recall: number | null; precision: number | null } };
type Result = {
  available: boolean; generated_at: string; seed: number; text_backend: string;
  dataset: { institutions: number; complaints: number; true_overlap_pairs: number; hard_negative_pairs: number; hindi_complaints: number; candidate_pairs_scored: number; naive_pairs: number };
  systems: Record<string, System>;
  calibration: { uncalibrated: { ece: number }; platt: { a: number; b: number; ece: number; fitted_on_seed: number }; note: string };
  institution_resolution: { auto_resolved_share: number; auto_resolve_precision: number | null; top3_recall: number; needs_officer_share: number; sibling_campus_auto_resolved: number; sibling_campus_false_merges: number };
  targets: { recall: number; precision: number };
  caveats: string[];
  embedding?: Result | null;
};

const KIND: Record<string, string> = { dup_multichannel: "Same complainant, two channels", cpgrams_forward: "CPGRAMS forward of an RB matter", paraphrase: "Paraphrase, different complainants", hindi_english: "Hindi–English pair" };
const f = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(3));

function SystemsTable({ r }: { r: Result }) {
  const names = Object.keys(r.systems);
  return (
    <Table head={["System", "Precision", "Recall", "F1", ...Object.values(KIND), "False merges: sibling campus"]}>
      {names.map((n) => {
        const s = r.systems[n];
        const ours = n.startsWith("Samanvay");
        return (
          <tr key={n} className={ours ? "bg-cream font-semibold" : ""}>
            <td>{n}</td>
            <td className="tabular">{f(s.precision)}</td><td className="tabular">{f(s.recall)}</td><td className="tabular font-bold">{f(s.f1)}</td>
            {Object.keys(KIND).map((k) => <td key={k} className="tabular">{f(s.recall_by_kind[k])}</td>)}
            <td className="tabular">{f(s.false_positive_rate_hard_negatives.neg_sibling)}</td>
          </tr>
        );
      })}
    </Table>
  );
}

export default function BenchmarkPage() {
  const { me } = useSession();
  const { data, error, isLoading, mutate } = useApi<Result>("/eval/overlap");
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState<unknown>(null);
  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data?.available) return <Empty title="No benchmark run yet.">Run <code>python -m app.ml.benchmark</code> in the backend.</Empty>;
  const ours = Object.entries(data.systems).find(([n]) => n.startsWith("Samanvay"))?.[1];
  const baseline = data.systems["B1 + fuzzy institution name"];
  const rerun = async () => {
    setBusy(true);
    setRunError(null);
    try {
      await api("/eval/overlap/run", { method: "POST" });
      mutate();
    } catch (e) {
      setRunError(e);
    } finally {
      setBusy(false);
    }
  };
  const ir = data.institution_resolution;
  return (
    <div className="flex flex-col gap-6">
      <Hero kicker={`Synthetic benchmark · seed ${data.seed} · ${data.text_backend}`} title="How do we know the matching works?"
        side={hasRole(me, "SYS_ADMIN", "SENIOR_MGMT") && <Button variant="light" busy={busy} onClick={rerun} arrow>Re-run now</Button>}>
        {data.dataset.complaints.toLocaleString("en-IN")} bilingual complaints about {data.dataset.institutions} institutions, {data.dataset.true_overlap_pairs} injected true overlaps of four kinds
        and {data.dataset.hard_negative_pairs} hard negatives. Labels never enter the application database. Generated {fmtDateTime(data.generated_at)}.
      </Hero>
      <ErrorNote error={runError} />
      {ours && baseline && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card tone="mint"><p className="text-sm font-bold">F1 vs fuzzy-name baseline</p><p className="text-4xl font-extrabold tabular">{ours.f1.toFixed(2)} <span className="text-lg opacity-70">vs {baseline.f1.toFixed(2)}</span></p></Card>
          <Card tone="yellow"><p className="text-sm font-bold">Precision · target ≥ {data.targets.precision}</p><p className="text-4xl font-extrabold tabular">{ours.precision.toFixed(2)}</p><div className="mt-2"><Bar value={ours.precision} max={1} tone="navy" /></div></Card>
          <Card tone="sky"><p className="text-sm font-bold">Recall · target ≥ {data.targets.recall}</p><p className="text-4xl font-extrabold tabular">{ours.recall.toFixed(2)}</p><div className="mt-2"><Bar value={ours.recall} max={1} tone="navy" /></div>
            {ours.recall < data.targets.recall && <p className="mt-1 text-xs font-semibold">Below target; the gap is Hindi–English pairs.</p>}</Card>
        </div>
      )}
      <Card>
        <h2 className="mb-3 font-bold">Overlap detection by system and overlap kind (recall per kind)</h2>
        <SystemsTable r={data} />
        <p className="mt-2 text-xs text-muted">B0 = exact Permanent ID or exact name + same category within 90 days. B1 = B0 with fuzzy institution names. All three run on the same data.</p>
      </Card>
      {data.embedding && (
        <Card tone="cream">
          <h2 className="mb-3 font-bold">With multilingual embeddings ({data.embedding.text_backend})</h2>
          <SystemsTable r={data.embedding} />
          <p className="mt-2 text-xs text-muted">Optional backend (model download, CPU). Hindi–English recall {f(data.embedding.systems["Samanvay cascade"]?.recall_by_kind.hindi_english)} vs {f(ours?.recall_by_kind.hindi_english)} with n-grams.</p>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-bold">Institution resolution</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-xs text-muted">Auto-resolve precision</dt><dd className="text-2xl font-extrabold tabular">{f(ir.auto_resolve_precision)}</dd></div>
            <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-xs text-muted">Top-3 recall</dt><dd className="text-2xl font-extrabold tabular">{f(ir.top3_recall)}</dd></div>
            <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-xs text-muted">Sent to an officer</dt><dd className="text-2xl font-extrabold tabular">{Math.round(ir.needs_officer_share * 100)}%</dd></div>
            <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-xs text-muted">Sibling-campus false merges</dt><dd className="text-2xl font-extrabold tabular">{ir.sibling_campus_false_merges} <span className="text-sm font-semibold">/ {ir.sibling_campus_auto_resolved}</span></dd></div>
          </dl>
        </Card>
        <Card>
          <h2 className="font-bold">Calibration</h2>
          <p className="mt-2 text-sm">Expected calibration error {data.calibration.uncalibrated.ece} uncalibrated → <b>{data.calibration.platt.ece}</b> after Platt scaling (a = {data.calibration.platt.a}, b = {data.calibration.platt.b}).</p>
          <p className="mt-2 text-xs text-muted">{data.calibration.note}</p>
          <p className="mt-3 text-xs text-muted">Pairs scored: {data.dataset.candidate_pairs_scored.toLocaleString("en-IN")} of {data.dataset.naive_pairs.toLocaleString("en-IN")} naive pairs (blocking by institution, complainant hash and references).</p>
        </Card>
      </div>
      <Card tone="cream">
        <h2 className="font-bold">Read this before quoting numbers</h2>
        <ul className="mt-2 list-disc pl-5 text-sm">{data.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
        <p className="mt-2"><Badge tone="warn">Synthetic data only</Badge></p>
      </Card>
    </div>
  );
}
