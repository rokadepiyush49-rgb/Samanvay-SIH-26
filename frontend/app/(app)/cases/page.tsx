"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CaseTable } from "@/components/cases";
import { Button, Empty, ErrorNote, Field, PageHead, Spinner, inputCls } from "@/components/ui";
import { api, qs, useApi } from "@/lib/api";
import { ago } from "@/lib/format";
import type { CaseList, CaseRow, Meta } from "@/lib/types";

const KEYS = ["q", "institution", "permanent_id", "unit", "region", "category", "status", "channel", "date_from", "date_to",
  "overdue", "escalated", "overlap", "open_only", "resolution", "institution_id"] as const;

type Filters = Record<(typeof KEYS)[number], string>;

/** Remounted (keyed by the query string) whenever the URL filters change, so form and paging state start fresh. */
function Register({ initial }: { initial: Filters }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const query = qs({ ...initial, limit: 50 });
  const { data, error, isLoading, mutate } = useApi<CaseList>(`/cases${query}`);
  const { data: meta } = useApi<Meta>("/meta");
  const [more_, setMore] = useState<{ items: CaseRow[]; cursor: string | null } | null>(null);
  const extra = more_?.items ?? [];
  const cursor = more_ ? more_.cursor : (data?.next_cursor ?? null);

  const apply = (e?: React.FormEvent) => {
    e?.preventDefault();
    router.push(`/cases${qs(form)}`);
  };
  const more = async () => {
    if (!cursor) return;
    const next = await api<CaseList>(`/cases${qs({ ...initial, limit: 50, cursor })}`);
    setMore({ items: [...extra, ...next.items], cursor: next.next_cursor });
  };
  const set = (k: (typeof KEYS)[number]) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const chips = KEYS.filter((k) => initial[k]);
  return (
    <div className="flex flex-col gap-5">
      <PageHead title="All cases register">
        Every institution-related case across units. Other units&apos; cases show metadata (holder, status, dates); complaint text is visible to the holding unit and coordinating units only.
      </PageHead>
      <form onSubmit={apply} className="grid gap-3 rounded-3xl border border-rule bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search"><input className={inputCls} value={form.q} onChange={set("q")} placeholder="text, id:SMV-…, pid:1-…, unit:RB" /></Field>
        <Field label="Institution name"><input className={inputCls} value={form.institution} onChange={set("institution")} placeholder="fuzzy, e.g. S.V. Inst. Engg" /></Field>
        <Field label="Permanent ID"><input className={inputCls} value={form.permanent_id} onChange={set("permanent_id")} placeholder="1-…" /></Field>
        <Field label="Bureau / Cell">
          <select className={inputCls} value={form.unit} onChange={set("unit")}>
            <option value="">All units</option>
            {meta?.units.map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}
          </select>
        </Field>
        <Field label="Region">
          <select className={inputCls} value={form.region} onChange={set("region")}>
            <option value="">All regions</option>
            {meta?.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select className={inputCls} value={form.category} onChange={set("category")}>
            <option value="">All categories</option>
            {meta?.categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className={inputCls} value={form.status} onChange={set("status")}>
            <option value="">Any status</option>
            <optgroup label="PS reporting categories">
              <option value="pending">Pending</option><option value="under_process">Under process</option>
              <option value="disposed">Disposed</option><option value="transferred">Transferred (in flight)</option>
              <option value="open">All open</option>
            </optgroup>
            <optgroup label="Exact status">{meta?.statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</optgroup>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Received from"><input type="date" className={inputCls} value={form.date_from} onChange={set("date_from")} /></Field>
          <Field label="to"><input type="date" className={inputCls} value={form.date_to} onChange={set("date_to")} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
          {(["overdue", "escalated", "overlap", "open_only"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={form[k] === "true"} onChange={(e) => setForm({ ...form, [k]: e.target.checked ? "true" : "" })} className="h-4 w-4 accent-[var(--navy)]" />
              {{ overdue: "Overdue", escalated: "Escalated", overlap: "Undecided overlap", open_only: "Open only" }[k]}
            </label>
          ))}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={() => router.push("/cases")}>Reset</Button>
            <Button type="submit" arrow>Apply filters</Button>
          </div>
        </div>
      </form>
      {chips.length > 0 && <p className="text-xs text-muted">Filters: {chips.map((k) => `${k}=${initial[k]}`).join(" · ")}</p>}
      {isLoading && <Spinner />}
      <ErrorNote error={error} onRetry={() => mutate()} />
      {data && (
        <>
          <div className="flex items-baseline justify-between">
            <p className="text-sm"><b className="text-lg tabular">{data.total.toLocaleString("en-IN")}</b> cases match · updated {ago(data.as_of)}</p>
          </div>
          {data.items.length === 0 ? <Empty title="No cases match these filters."><button className="font-semibold underline" onClick={() => router.push("/cases")}>Reset filters</button></Empty>
            : <CaseTable rows={[...data.items, ...extra]} />}
          {cursor && <div className="text-center"><Button variant="soft" onClick={more}>Load more</Button></div>}
        </>
      )}
    </div>
  );
}

function RegisterFromUrl() {
  const sp = useSearchParams();
  const initial = Object.fromEntries(KEYS.map((k) => [k, sp.get(k) ?? ""])) as Filters;
  return <Register key={sp.toString()} initial={initial} />;
}

export default function CasesPage() {
  return <Suspense fallback={<Spinner />}><RegisterFromUrl /></Suspense>;
}
