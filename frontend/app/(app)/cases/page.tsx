"use client";

import { Download, FilePlus2, Filter, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CaseTable, REGISTER_COLUMNS } from "@/components/cases";
import { Require } from "@/components/require";
import { Badge, Button, ButtonLink, EmptyState, ErrorNote, Field, PageHeader, Pagination, TableSkeleton, cx, inputCls } from "@/components/ui";
import { qs, useApi } from "@/lib/api";
import { ago, fmtDate, label } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import type { CaseRow, Meta } from "@/lib/types";
import { usePagedCases } from "@/lib/use-paged-cases";

const KEYS = ["q", "institution", "permanent_id", "unit", "region", "category", "status", "channel", "date_from", "date_to",
  "overdue", "escalated", "overlap", "open_only", "resolution", "institution_id", "order"] as const;
type Key = (typeof KEYS)[number];
type Filters = Record<Key, string>;

const FLAG_LABEL: Partial<Record<Key, string>> = { overdue: "Overdue", escalated: "Escalated", overlap: "Undecided overlap", open_only: "Open only" };
const BUCKET_LABEL: Record<string, string> = { pending: "Pending", under_process: "Under process", disposed: "Disposed", transferred: "Transfer in flight", open: "All open" };

function chipText(k: Key, v: string, meta?: Meta): string {
  if (FLAG_LABEL[k]) return FLAG_LABEL[k]!;
  if (k === "status") return `Status: ${BUCKET_LABEL[v] ?? meta?.statuses.find((s) => s.code === v)?.label ?? label(v)}`;
  if (k === "unit") return `Unit: ${v}`;
  if (k === "region") return `Region: ${meta?.regions.find((r) => String(r.id) === v)?.name ?? v}`;
  if (k === "category") return `Category: ${meta?.categories.find((c) => c.code === v)?.name ?? v}`;
  if (k === "channel") return `Channel: ${label(v)}`;
  if (k === "date_from") return `From ${fmtDate(v)}`;
  if (k === "date_to") return `To ${fmtDate(v)}`;
  if (k === "q") return `“${v}”`;
  if (k === "institution") return `Institution: ${v}`;
  if (k === "permanent_id") return `PID ${v}`;
  if (k === "resolution") return v === "PENDING" ? "Institution unconfirmed" : `Resolution: ${label(v)}`;
  if (k === "institution_id") return "One institution";
  return `${k}: ${v}`;
}

function exportCsv(rows: CaseRow[]) {
  const head = ["Case no", "Received", "Institution", "Permanent ID", "Category", "Channel", "Holding unit", "Officer", "Status", "Expected disposal", "Overdue"];
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const body = rows.map((c) => [c.case_no, c.received_on, c.institution?.name ?? c.institution_raw ?? "", c.institution?.permanent_id ?? "", c.category.name, c.channel,
    c.holding_unit.code, c.holding_officer?.name ?? "", c.status_label, c.expected_disposal ?? "", c.overdue ? "yes" : "no"].map(esc).join(","));
  const blob = new Blob([[head.map(esc).join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `samanvay-cases-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Results({ filters }: { filters: Filters }) {
  const { me } = useSession();
  const router = useRouter();
  const { order, ...rest } = filters;
  const paged = usePagedCases({ ...rest, order: order || "received" }, 25);
  const { data, error, isLoading, isValidating, mutate } = paged;
  if (isLoading && !data) return <TableSkeleton rows={10} />;
  if (error) return <ErrorNote error={error} onRetry={() => mutate()} />;
  if (!data) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" aria-live="polite"><b className="tabular">{data.total.toLocaleString("en-IN")}</b> cases match · updated {ago(data.as_of)}</p>
        {can(me, "cases.export") && data.items.length > 0 && (
          <Button size="sm" variant="secondary" icon={<Download size={14} aria-hidden />} onClick={() => exportCsv(data.items)} title="Exports the rows on this page with the fields visible to you">Export this page (CSV)</Button>
        )}
      </div>
      {data.items.length === 0 ? (
        <EmptyState title="No cases match these filters" action={<Button variant="secondary" onClick={() => router.push("/cases")}>Reset filters</Button>}>
          Check the spelling of the institution, widen the date range, or remove a filter.
        </EmptyState>
      ) : (
        <>
          <div aria-busy={isValidating} className={isValidating ? "pointer-events-none opacity-60 transition-opacity" : undefined}>
            <CaseTable rows={data.items} columns={REGISTER_COLUMNS} caption="Case register" />
          </div>
          <Pagination page={paged.page} pageSize={paged.pageSize} total={data.total} onPrev={paged.prev} onNext={paged.next} hasNext={paged.hasNext} busy={isValidating} />
        </>
      )}
    </div>
  );
}

function Register({ initial }: { initial: Filters }) {
  const router = useRouter();
  const pathname = usePathname();
  const { me, t } = useSession();
  const { data: meta } = useApi<Meta>("/meta");
  const [form, setForm] = useState(initial);
  const advanced: Key[] = ["institution", "permanent_id", "unit", "region", "category", "status", "channel", "date_from", "date_to", "overdue", "escalated", "overlap", "open_only"];
  const activeAdvanced = advanced.filter((k) => initial[k]).length;
  const [showFilters, setShowFilters] = useState(activeAdvanced > 0);
  const push = (f: Partial<Filters>) => router.push(`${pathname}${qs(f)}`);
  const apply = (e?: React.FormEvent) => { e?.preventDefault(); push(form); };
  const remove = (k: Key) => push({ ...initial, [k]: "" });
  const set = (k: Key) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const chips = KEYS.filter((k) => k !== "order" && initial[k]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("nav.cases")} crumbs={[{ label: t("group.workspace") }, { label: t("nav.cases") }]}
        description="Every institution-related case across bureaus, cells and regional offices. Other units' cases show metadata only; complaint text is visible to the holding unit and coordinating units."
        actions={can(me, "cases.create") && <ButtonLink href="/cases/new" variant="primary" icon={<FilePlus2 size={16} aria-hidden />}>{t("action.newCase")}</ButtonLink>} />

      <form onSubmit={apply} className="flex flex-col gap-3 rounded-xl border border-rule bg-surface p-3 shadow-card" role="search" aria-label="Search the case register">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <label htmlFor="f-q" className="sr-only">Search cases</label>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input id="f-q" className={cx(inputCls, "pl-9")} value={form.q} onChange={set("q")} placeholder="Case ID (SMV-…), institution name, AICTE Permanent ID (1-…) or text" />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <span className="sr-only sm:not-sr-only">Sort</span>
            <select className={cx(inputCls, "w-auto")} value={form.order || "received"} onChange={(e) => { const f = { ...form, order: e.target.value === "received" ? "" : e.target.value }; setForm(f); push(f); }} aria-label="Sort order">
              <option value="received">Newest received</option>
              <option value="due">Deadline (earliest first)</option>
            </select>
          </label>
          <Button type="button" variant="secondary" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters} aria-controls="filters" icon={<Filter size={15} aria-hidden />}>
            Filters{activeAdvanced > 0 && <span className="rounded-full bg-action px-1.5 text-[11px] text-white tabular">{activeAdvanced}</span>}
          </Button>
          <Button type="submit">{t("action.search")}</Button>
        </div>

        {showFilters && (
          <div id="filters" className="grid gap-3 border-t border-rule pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field id="f-inst" label="Institution name"><input id="f-inst" className={inputCls} value={form.institution} onChange={set("institution")} placeholder="Fuzzy, e.g. S.V. Inst. Engg" /></Field>
            <Field id="f-pid" label="AICTE Permanent ID"><input id="f-pid" className={cx(inputCls, "font-mono")} value={form.permanent_id} onChange={set("permanent_id")} placeholder="1-…" /></Field>
            <Field id="f-unit" label="Bureau / cell / RO">
              <select id="f-unit" className={inputCls} value={form.unit} onChange={set("unit")}>
                <option value="">All units</option>
                {meta?.units.map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}
              </select>
            </Field>
            <Field id="f-region" label="Region">
              <select id="f-region" className={inputCls} value={form.region} onChange={set("region")}>
                <option value="">All regions</option>
                {meta?.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field id="f-cat" label="Complaint category">
              <select id="f-cat" className={inputCls} value={form.category} onChange={set("category")}>
                <option value="">All categories</option>
                {meta?.categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </Field>
            <Field id="f-status" label="Status">
              <select id="f-status" className={inputCls} value={form.status} onChange={set("status")}>
                <option value="">Any status</option>
                <optgroup label="Reporting category">{Object.entries(BUCKET_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
                <optgroup label="Exact status">{meta?.statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</optgroup>
              </select>
            </Field>
            <Field id="f-channel" label="Source channel">
              <select id="f-channel" className={inputCls} value={form.channel} onChange={set("channel")}>
                <option value="">Any channel</option>
                {meta?.channels.map((c) => <option key={c} value={c}>{label(c)}</option>)}
              </select>
            </Field>
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="sr-only">Received date range</legend>
              <Field id="f-from" label="Received from"><input id="f-from" type="date" className={inputCls} value={form.date_from} onChange={set("date_from")} /></Field>
              <Field id="f-to" label="to"><input id="f-to" type="date" className={inputCls} value={form.date_to} onChange={set("date_to")} /></Field>
            </fieldset>
            <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:col-span-2 lg:col-span-4">
              <legend className="mb-1 text-sm font-medium">Urgency</legend>
              {(["overdue", "escalated", "overlap", "open_only"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form[k] === "true"} onChange={(e) => setForm({ ...form, [k]: e.target.checked ? "true" : "" })} className="h-4 w-4 accent-[var(--action)]" />
                  {FLAG_LABEL[k]}
                </label>
              ))}
              <div className="ml-auto flex gap-2">
                <Button type="button" variant="ghost" onClick={() => router.push("/cases")}>{t("action.reset")}</Button>
                <Button type="submit">{t("action.apply")}</Button>
              </div>
            </fieldset>
          </div>
        )}
      </form>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          <span className="text-xs font-medium text-muted">Active filters:</span>
          {chips.map((k) => (
            <Badge key={k} tone="info">
              {chipText(k, initial[k], meta)}
              <button type="button" onClick={() => remove(k)} className="-mr-1 rounded p-0.5 hover:bg-action/10" aria-label={`Remove filter ${chipText(k, initial[k], meta)}`}><X size={12} /></button>
            </Badge>
          ))}
          <button type="button" onClick={() => router.push("/cases")} className="text-xs font-medium text-action hover:underline">Clear all</button>
        </div>
      )}

      <Results key={qs(initial)} filters={initial} />
    </div>
  );
}

function RegisterFromUrl() {
  const sp = useSearchParams();
  const initial = Object.fromEntries(KEYS.map((k) => [k, sp.get(k) ?? ""])) as Filters;
  return <Register key={sp.toString()} initial={initial} />;
}

export default function CasesPage() {
  return <Require cap="cases.view"><Suspense fallback={<TableSkeleton />}><RegisterFromUrl /></Suspense></Require>;
}
