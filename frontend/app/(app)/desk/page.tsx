"use client";

import {
  AlarmClock, ArrowLeftRight, ArrowRight, Briefcase, Building2, CalendarClock, ChevronRight, FilePlus2, FileUp, Flag, HelpCircle,
  Inbox, Network, Search, TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CaseTable } from "@/components/cases";
import { Require } from "@/components/require";
import { MyTasksCard } from "@/components/tasks";
import { Button, ButtonLink, Card, EmptyState, ErrorState, KpiCard, PageHeader, PageSkeleton, cx, inputCls } from "@/components/ui";
import { qs, useApi } from "@/lib/api";
import { ago, num, todayLong } from "@/lib/format";
import { can } from "@/lib/permissions";
import { byUrgency } from "@/lib/priority";
import { useSession } from "@/lib/session";
import type { CaseList, Desk } from "@/lib/types";

function useCount(params: Record<string, string | boolean | undefined> | null) {
  const { data } = useApi<CaseList>(params ? `/cases${qs({ ...params, limit: 1 })}` : null, { refreshInterval: 60000 });
  return data?.total;
}

type Alert = { key: string; tone: "danger" | "warn" | "coord" | "info"; icon: ReactNode; count: number; title: string; detail: string; href: string; cta: string };

const ALERT_TONE = { danger: "bg-danger-soft text-danger", warn: "bg-warn-soft text-warn", coord: "bg-coord-soft text-coord", info: "bg-action-soft text-action" };

function PriorityAlerts({ alerts }: { alerts: Alert[] }) {
  const shown = alerts.filter((a) => a.count > 0);
  return (
    <Card title="Needs attention" description="Ordered by severity. Each item opens the exact records." padded={false}>
      {shown.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">Nothing needs immediate attention. Deadlines, transfers and overlaps are all on track.</p>
      ) : (
        <ul className="divide-y divide-rule" data-testid="priority-alerts">
          {shown.map((a) => (
            <li key={a.key}>
              <Link href={a.href} className="group flex items-center gap-3 px-5 py-3 hover:bg-surface-2/70">
                <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-lg", ALERT_TONE[a.tone])} aria-hidden>{a.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold"><span className="tabular">{num(a.count)}</span> {a.title}</span>
                  <span className="block truncate text-xs text-muted">{a.detail}</span>
                </span>
                <span className="hidden shrink-0 text-xs font-medium text-action group-hover:underline sm:inline">{a.cta}</span>
                <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function QuickActions() {
  const router = useRouter();
  const { me, t } = useSession();
  const [no, setNo] = useState("");
  const links = [
    { href: "/institutions", label: "Search institutions", icon: <Building2 size={16} aria-hidden /> },
    { href: "/coordination", label: "View coordination alerts", icon: <Network size={16} aria-hidden /> },
    { href: "/transfers", label: "Review pending transfers", icon: <ArrowLeftRight size={16} aria-hidden /> },
    ...(can(me, "imports.run") ? [{ href: "/imports", label: t("nav.imports"), icon: <FileUp size={16} aria-hidden /> }] : []),
  ];
  return (
    <Card title="Quick actions">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = no.trim().toUpperCase(); if (v) router.push(v.startsWith("SMV-") ? `/cases/${v}` : `/cases${qs({ q: no.trim() })}`); }}>
        <label htmlFor="open-case" className="sr-only">Open a case by number</label>
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input id="open-case" value={no} onChange={(e) => setNo(e.target.value)} placeholder="Open a case: SMV-2026-…" className={cx(inputCls, "pl-9 font-mono text-[13px]")} />
        </div>
        <Button type="submit" variant="secondary">Open</Button>
      </form>
      <ul className="mt-3 grid gap-1">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium hover:bg-surface-2">
              <span className="text-muted">{l.icon}</span>{l.label}<ArrowRight size={14} className="ml-auto text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DeskView() {
  const { me, t } = useSession();
  const { data, error, mutate, isLoading } = useApi<Desk>("/dashboard/desk", { refreshInterval: 30000 });
  const mine = data?.scope === "mine" ? true : undefined;
  const scope = { unit: me.unit.code, mine, open_only: true };
  const pending = useCount(data ? { ...scope, status: "pending" } : null);
  const overdue = useCount(data ? { ...scope, overdue: true } : null);
  const escalated = useCount(data ? { ...scope, escalated: true } : null);

  if (isLoading) return <PageSkeleton label="Loading your desk" />;
  if (error || !data) return <ErrorState error={error} onRetry={() => mutate()} />;

  const top = [...data.worklist].sort(byUrgency).slice(0, 8);
  const dueSoon = data.worklist.filter((c) => !c.overdue && c.working_days_left !== null && c.working_days_left <= 3).length;
  const capped = data.worklist_total > data.worklist.length;
  const scopeQs = qs({ unit: me.unit.code, mine, open_only: true });
  const alerts: Alert[] = [
    { key: "overdue", tone: "danger", icon: <AlarmClock size={18} />, count: overdue ?? data.overdue, title: "overdue cases", detail: "Past the expected disposal date", href: `/worklist?view=overdue`, cta: "Review" },
    { key: "parallel", tone: "coord", icon: <Flag size={18} />, count: data.coordination_open.filter((c) => c.type === "P").length, title: "parallel-action overlaps", detail: "Another unit is acting on the same institution", href: "/coordination", cta: "Coordinate" },
    { key: "transfers", tone: "warn", icon: <ArrowLeftRight size={18} />, count: data.transfers_awaiting.length, title: "transfers awaiting your acceptance", detail: "Custody stays with the sending unit until accepted", href: "/transfers", cta: "Accept or return" },
    { key: "coord", tone: "coord", icon: <Network size={18} />, count: data.coordination_open.filter((c) => c.type !== "P").length, title: "other overlap cards to decide", detail: "Duplicate or related matters across units", href: "/coordination", cta: "Decide" },
    { key: "due", tone: "warn", icon: <CalendarClock size={18} />, count: dueSoon, title: "due within 3 working days", detail: capped ? "Among your 50 most urgent cases" : "Act now to stay within timeline", href: "/worklist", cta: "Plan" },
    { key: "escalated", tone: "danger", icon: <TrendingUp size={18} />, count: escalated ?? 0, title: "escalated cases", detail: "Raised to the unit head or nodal officer", href: "/worklist?view=escalated", cta: "Review" },
    { key: "unresolved", tone: "info", icon: <HelpCircle size={18} />, count: data.unresolved_institutions, title: "cases need institution confirmation", detail: "Overlap matching runs after confirmation", href: "/worklist?view=unresolved&scope=unit", cta: "Confirm" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("nav.desk")}
        description={<>{me.unit.name} · {data.scope === "unit" ? "whole-unit view (unit head)" : "cases assigned to you"}</>}
        meta={<><span>{todayLong()}</span><span aria-hidden>·</span><span>Updated {ago(data.as_of)} · refreshes every 30 s</span></>}
        actions={can(me, "cases.create") && <ButtonLink href="/cases/new" variant="primary" icon={<FilePlus2 size={16} aria-hidden />}>{t("action.newCase")}</ButtonLink>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Open cases" value={num(data.worklist_total)} hint={data.scope === "unit" ? "held by your unit" : "assigned to you"} icon={<Briefcase size={18} />} tone="info" href={`/cases${scopeQs}`} testId="kpi-open" />
        <KpiCard label="Pending" value={num(pending)} hint="not yet under examination" icon={<Inbox size={18} />} tone="warn" href={`/cases${qs({ unit: me.unit.code, mine, status: "pending" })}`} />
        <KpiCard label="Due in 7 days" value={num(data.due_this_week)} hint={capped ? "among the 50 most urgent" : "expected disposal this week"} icon={<CalendarClock size={18} />} tone="coord" href="/worklist" />
        <KpiCard label="Overdue" value={num(overdue ?? data.overdue)} hint="past expected disposal" icon={<AlarmClock size={18} />} tone="danger" href="/worklist?view=overdue" testId="kpi-overdue" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="top-h">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="top-h" className="text-base font-semibold">Priority worklist</h2>
              <p className="text-xs text-muted">Your 8 most urgent open cases. Priority is derived from deadline, escalation, overlap and transfer state.</p>
            </div>
            <ButtonLink href="/worklist" size="sm" variant="secondary">Open full worklist<ArrowRight size={14} aria-hidden /></ButtonLink>
          </div>
          {top.length === 0 ? (
            <EmptyState title="No open cases on your desk">New cases assigned to you appear here. {can(me, "imports.run") && <Link className="font-medium text-action underline" href="/imports">Import a register</Link>}</EmptyState>
          ) : <CaseTable rows={top} columns={["priority", "case", "institution", "status", "due", "next"]} caption="Priority worklist" />}
        </section>
        <div className="flex flex-col gap-6">
          <PriorityAlerts alerts={alerts} />
          <MyTasksCard />
          <QuickActions />
        </div>
      </div>
    </div>
  );
}

export default function DeskPage() {
  return <Require cap="desk.view"><DeskView /></Require>;
}
