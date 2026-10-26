"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CaseTable, WORKLIST_COLUMNS } from "@/components/cases";
import { Require } from "@/components/require";
import { Button, EmptyState, ErrorNote, PageHeader, Pagination, TableSkeleton, cx, inputCls } from "@/components/ui";
import { qs } from "@/lib/api";
import { ago } from "@/lib/format";
import { hasRole } from "@/lib/permissions";
import { byUrgency } from "@/lib/priority";
import { useSession } from "@/lib/session";
import { usePagedCases } from "@/lib/use-paged-cases";

const VIEWS = [
  { value: "all", label: "All open", params: {} },
  { value: "overdue", label: "Overdue", params: { overdue: true } },
  { value: "overlap", label: "Coordination required", params: { overlap: true } },
  { value: "escalated", label: "Escalated", params: { escalated: true } },
  { value: "transfers", label: "Transfer in flight", params: { status: "transferred" } },
  { value: "unresolved", label: "Institution unconfirmed", params: { resolution: "PENDING" } },
] as const;
type View = (typeof VIEWS)[number]["value"];

function List({ view, scope, q, order }: { view: View; scope: "mine" | "unit"; q: string; order: "due" | "received" }) {
  const { me } = useSession();
  const params = { unit: me.unit.code, open_only: true, mine: scope === "mine" || undefined, q: q || undefined, order, ...VIEWS.find((v) => v.value === view)!.params };
  const paged = usePagedCases(params, 25);
  const { data, error, isLoading, isValidating, mutate } = paged;
  if (isLoading && !data) return <TableSkeleton rows={8} />;
  if (error) return <ErrorNote error={error} onRetry={() => mutate()} />;
  if (!data) return null;
  const rows = order === "due" ? [...data.items].sort(byUrgency) : data.items;
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <EmptyState title={view === "all" ? "No open cases" : "No cases in this view"}>
          {view === "all" ? "Cases assigned to you appear here." : "Try another view or switch to the whole unit."}
        </EmptyState>
      ) : (
        <>
          <div aria-busy={isValidating} className={isValidating ? "pointer-events-none opacity-60 transition-opacity" : undefined}>
            <CaseTable rows={rows} columns={WORKLIST_COLUMNS} caption="My worklist" />
          </div>
          <Pagination page={paged.page} pageSize={paged.pageSize} total={data.total} onPrev={paged.prev} onNext={paged.next} hasNext={paged.hasNext} busy={isValidating} />
        </>
      )}
      <p className="text-xs text-muted">Updated {ago(data.as_of)}. Within each page, rows are ordered by priority, then working days left.</p>
    </div>
  );
}

function Worklist() {
  const { me, t } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const head = hasRole(me, "UNIT_HEAD");
  const intakeOnly = me.roles.length === 1 && me.roles[0] === "INTAKE_OFFICER";
  const view = (VIEWS.some((v) => v.value === sp.get("view")) ? sp.get("view") : "all") as View;
  const scope = (sp.get("scope") ?? (head || intakeOnly ? "unit" : "mine")) as "mine" | "unit";
  const order = sp.get("order") === "received" ? "received" : "due";
  const q = sp.get("q") ?? "";
  const [text, setText] = useState(q);
  const set = (patch: Record<string, string | undefined>) => router.replace(`${pathname}${qs({ view, scope, order, q, ...patch })}`, { scroll: false });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("nav.worklist")} crumbs={[{ label: t("group.workspace") }, { label: t("nav.worklist") }]}
        description={`Open cases ${scope === "mine" ? "assigned to you" : `held by ${me.unit.code}`}, most urgent first. Select a row to open the case workspace.`} />

      <div className="flex flex-col gap-3 rounded-xl border border-rule bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Whose cases" className="inline-flex rounded-lg border border-rule-strong p-0.5">
            {(["mine", "unit"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={scope === s} onClick={() => set({ scope: s })}
                className={cx("rounded-md px-3 py-1.5 text-[13px] font-medium", scope === s ? "bg-navy text-white" : "text-muted hover:text-ink")}>
                {s === "mine" ? "Assigned to me" : `Whole unit (${me.unit.code})`}
              </button>
            ))}
          </div>
          <form className="relative min-w-[14rem] flex-1" onSubmit={(e) => { e.preventDefault(); set({ q: text.trim() || undefined }); }} role="search">
            <label htmlFor="wl-q" className="sr-only">Search within worklist</label>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input id="wl-q" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search case no., institution or text" className={cx(inputCls, "pl-9 pr-9")} />
            {q && <button type="button" onClick={() => { setText(""); set({ q: undefined }); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink" aria-label="Clear search"><X size={14} /></button>}
          </form>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            Sort
            <select value={order} onChange={(e) => set({ order: e.target.value })} className={cx(inputCls, "w-auto py-1.5")}>
              <option value="due">Urgency (deadline first)</option>
              <option value="received">Most recently received</option>
            </select>
          </label>
        </div>
        <div role="tablist" aria-label="Worklist views" className="flex flex-wrap gap-1.5">
          {VIEWS.map((v) => (
            <button key={v.value} role="tab" aria-selected={view === v.value} type="button" onClick={() => set({ view: v.value })}
              className={cx("rounded-full border px-3 py-1 text-[13px] font-medium transition-colors", view === v.value ? "border-action bg-action-soft text-action-ink" : "border-rule text-muted hover:border-rule-strong hover:text-ink")}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <List key={`${view}|${scope}|${q}|${order}`} view={view} scope={scope} q={q} order={order} />
      {q && <Button variant="ghost" size="sm" className="self-start" onClick={() => { setText(""); set({ q: undefined }); }}>Clear search “{q}”</Button>}
    </div>
  );
}

export default function WorklistPage() {
  return <Require cap="worklist.view"><Suspense fallback={<TableSkeleton />}><Worklist /></Suspense></Require>;
}
