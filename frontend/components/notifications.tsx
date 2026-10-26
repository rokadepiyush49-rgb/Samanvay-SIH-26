"use client";

import { ArrowLeftRight, Bell, Clock, Network, TrendingUp, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { ago } from "@/lib/format";
import type { Notification } from "@/lib/types";
import { cx } from "./ui";

export const FAMILY: Record<string, { label: string; icon: ReactNode }> = {
  OVERLAP: { label: "Overlap alert", icon: <TriangleAlert size={16} aria-hidden /> },
  COORDINATION: { label: "Coordination", icon: <Network size={16} aria-hidden /> },
  SLA: { label: "Deadline", icon: <Clock size={16} aria-hidden /> },
  TRANSFER: { label: "Transfer", icon: <ArrowLeftRight size={16} aria-hidden /> },
  ESCALATION: { label: "Escalation", icon: <TrendingUp size={16} aria-hidden /> },
  SYSTEM: { label: "System", icon: <Bell size={16} aria-hidden /> },
};

const SEVERITY: Record<string, { cls: string; text: string }> = {
  CRITICAL: { cls: "bg-danger-soft text-danger", text: "Critical" },
  WARNING: { cls: "bg-warn-soft text-warn", text: "Warning" },
  INFO: { cls: "bg-action-soft text-action", text: "Info" },
};

export function NotificationItem({ n, onOpen, now }: { n: Notification; onOpen: (n: Notification) => void; now?: number }) {
  const fam = FAMILY[n.family] ?? FAMILY.SYSTEM;
  const sev = SEVERITY[n.severity] ?? SEVERITY.INFO;
  return (
    <button type="button" onClick={() => onOpen(n)}
      className={cx("flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2", !n.read && "bg-action-soft/50")}>
      <span className={cx("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", sev.cls)} aria-hidden>{fam.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className={cx("block text-sm leading-snug", n.read ? "font-medium" : "font-semibold")}>{n.title}</span>
          {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-action" aria-hidden />}
        </span>
        {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.body}</span>}
        <span className="mt-1 block text-[11px] text-muted">
          {fam.label} · {sev.text} · <time dateTime={n.created_at}>{ago(n.created_at, now)}</time>
          <span className="sr-only">{n.read ? ", read" : ", unread"}</span>
        </span>
      </span>
    </button>
  );
}
