"use client";

import { Bell, CheckCheck } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FAMILY, NotificationItem } from "@/components/notifications";
import { Button, Card, EmptyState, ErrorNote, PageHeader, TableSkeleton, cx } from "@/components/ui";
import { api, qs, revalidate, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Notification, NotificationList } from "@/lib/types";

function Notifications() {
  const { t } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const family = sp.get("family") ?? "";
  const unread = sp.get("unread") === "1";
  const { data, error, isLoading, mutate } = useApi<NotificationList>(`/me/notifications${qs({ family, unread: unread || undefined, limit: 100 })}`, { refreshInterval: 30000 });
  const set = (patch: Record<string, string | undefined>) => router.replace(`${pathname}${qs({ family, unread: unread ? "1" : undefined, ...patch })}`, { scroll: false });
  const open = async (n: Notification) => {
    if (!n.read) await api(`/notifications/${n.id}/read`, { method: "POST" }).catch(() => undefined);
    revalidate("/me/notifications");
    if (n.link) router.push(n.link);
  };
  const readAll = async () => { await api("/me/notifications/read-all", { method: "POST" }).catch(() => undefined); revalidate("/me/notifications"); };
  const total = data?.unread_total ?? 0;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("nav.notifications")} crumbs={[{ label: t("group.system") }, { label: t("nav.notifications") }]}
        description="Overlap alerts, deadlines, transfer requests, escalations and coordination updates for you. Select one to open the affected record."
        actions={total > 0 && <Button variant="secondary" onClick={readAll} icon={<CheckCheck size={15} aria-hidden />}>{t("action.markAllRead")} ({total})</Button>} />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter notifications">
        {[["", "All types"], ...Object.entries(FAMILY).map(([k, v]) => [k, v.label])].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={family === k} onClick={() => set({ family: k || undefined })}
            className={cx("rounded-full border px-3 py-1 text-[13px] font-medium", family === k ? "border-action bg-action-soft text-action-ink" : "border-rule text-muted hover:text-ink")}>
            {l}{k && data?.unread[k] ? <span className="ml-1.5 rounded-full bg-action px-1.5 text-[11px] text-white tabular">{data.unread[k]}</span> : null}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={unread} onChange={(e) => set({ unread: e.target.checked ? "1" : undefined })} className="h-4 w-4 accent-[var(--action)]" />Unread only
        </label>
      </div>
      {isLoading && <TableSkeleton rows={6} />}
      <ErrorNote error={error} onRetry={() => mutate()} />
      {data && (data.items.length === 0 ? <EmptyState title={unread ? "No unread notifications" : "No notifications"} icon={<Bell size={20} />}>You are all caught up.</EmptyState> : (
        <Card padded={false}><ul className="divide-y divide-rule">{data.items.map((n) => <li key={n.id}><NotificationItem n={n} onOpen={open} /></li>)}</ul></Card>
      ))}
      <p className="text-xs text-muted">Showing the latest 100. New-assignment notices are not sent by the server yet; assigned cases appear on your worklist.</p>
    </div>
  );
}

export default function NotificationsPage() {
  return <Suspense fallback={<TableSkeleton />}><Notifications /></Suspense>;
}
