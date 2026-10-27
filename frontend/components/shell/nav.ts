import {
  ArrowLeftRight, BarChart3, Bell, Building2, FileUp, Gauge, LayoutDashboard, LifeBuoy, ListChecks, type LucideIcon, Network,
  ScrollText, Settings, ShieldCheck, Target, UserCog, Briefcase,
} from "lucide-react";
import { can, type Capability } from "@/lib/permissions";
import type { Me } from "@/lib/types";

export type NavItem = { href: string; key: string; icon: LucideIcon; cap?: Capability; badge?: "coordination" | "transfers" | "assistance" | "notifications" };
export type NavGroup = { key: string; items: NavItem[] };

/** One source for the sidebar, the command palette and the top-bar page context. */
export const NAV: NavGroup[] = [
  {
    key: "group.workspace",
    items: [
      { href: "/desk", key: "nav.desk", icon: LayoutDashboard, cap: "desk.view" },
      { href: "/worklist", key: "nav.worklist", icon: ListChecks, cap: "worklist.view" },
      { href: "/cases", key: "nav.cases", icon: Briefcase, cap: "cases.view" },
      { href: "/coordination", key: "nav.coordination", icon: Network, cap: "coordination.view", badge: "coordination" },
      { href: "/transfers", key: "nav.transfers", icon: ArrowLeftRight, cap: "transfers.view", badge: "transfers" },
      { href: "/assistance", key: "nav.assistance", icon: LifeBuoy, cap: "assistance.view", badge: "assistance" },
      { href: "/imports", key: "nav.imports", icon: FileUp, cap: "imports.run" },
    ],
  },
  {
    key: "group.institutions",
    items: [{ href: "/institutions", key: "nav.institutions", icon: Building2, cap: "institutions.view" }],
  },
  {
    key: "group.insights",
    items: [
      { href: "/cockpit", key: "nav.cockpit", icon: Gauge, cap: "cockpit.view" },
      { href: "/reports", key: "nav.reports", icon: BarChart3, cap: "reports.view" },
      { href: "/benchmark", key: "nav.benchmark", icon: Target, cap: "benchmark.view" },
    ],
  },
  {
    key: "group.system",
    items: [
      { href: "/notifications", key: "nav.notifications", icon: Bell, badge: "notifications" },
      { href: "/admin", key: "nav.admin", icon: UserCog, cap: "admin.view" },
      { href: "/audit", key: "nav.audit", icon: ShieldCheck, cap: "audit.view" },
      { href: "/settings", key: "nav.settings", icon: Settings },
    ],
  },
];

export function visibleNav(me: Pick<Me, "roles">): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.cap || can(me, i.cap)) })).filter((g) => g.items.length > 0);
}

export function activeItem(pathname: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of NAV)
    for (const item of group.items)
      if ((pathname === item.href || pathname.startsWith(`${item.href}/`)) && (!best || item.href.length > best.item.href.length)) best = { group, item };
  return best;
}

export const PageIcon = ScrollText;
