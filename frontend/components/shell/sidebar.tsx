"use client";

import { ChevronsLeft, ChevronsRight } from "lucide-react";
import Link from "next/link";
import { Tooltip } from "radix-ui";
import { useSession } from "@/lib/session";
import { cx } from "../ui";
import { Brand, BrandStripe } from "./brand";
import { visibleNav, type NavItem } from "./nav";

export type NavCounts = Partial<Record<NonNullable<NavItem["badge"]>, number>>;

function Count({ n, collapsed }: { n?: number; collapsed?: boolean }) {
  if (!n) return null;
  const text = n > 99 ? "99+" : String(n);
  return collapsed ? (
    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-gold ring-2 ring-navy" aria-hidden />
  ) : (
    <span className="ml-auto min-w-5 rounded-full bg-gold px-1.5 text-center text-[11px] font-bold leading-5 text-navy tabular">{text}</span>
  );
}

export function SidebarNav({ pathname, counts, collapsed, onNavigate }: { pathname: string; counts: NavCounts; collapsed?: boolean; onNavigate?: () => void }) {
  const { me, t } = useSession();
  const groups = visibleNav(me);
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.key}>
          {collapsed ? <div className="mx-3 mb-2 border-t border-white/10" aria-hidden /> : (
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-on-navy-muted">{t(g.key)}</p>
          )}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const n = item.badge ? counts[item.badge] : undefined;
              const label = t(item.key);
              const link = (
                <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? `${label}${n ? `, ${n} pending` : ""}` : undefined}
                  className={cx("relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors",
                    active ? "bg-white/12 text-white" : "text-on-navy hover:bg-white/8 hover:text-white",
                    collapsed && "justify-center px-0")}>
                  {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-gold" aria-hidden />}
                  <item.icon size={18} strokeWidth={1.9} className={active ? "text-gold" : "text-on-navy-muted"} aria-hidden />
                  {!collapsed && <span className="truncate">{label}</span>}
                  {!collapsed && n ? <span className="sr-only">, {n} pending</span> : null}
                  <Count n={n} collapsed={collapsed} />
                </Link>
              );
              return (
                <li key={item.href}>
                  {collapsed ? (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content side="right" sideOffset={8} className="z-50 rounded-md bg-ink px-2.5 py-1.5 text-xs font-medium text-white shadow-pop">
                          {label}{n ? ` · ${n}` : ""}
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  ) : link}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ pathname, counts, collapsed, onToggle }: { pathname: string; counts: NavCounts; collapsed: boolean; onToggle: () => void }) {
  const { me, t } = useSession();
  return (
    <aside className={cx("sticky top-0 hidden h-screen shrink-0 flex-col bg-navy text-on-navy transition-[width] duration-200 lg:flex", collapsed ? "w-[72px]" : "w-[256px]")}>
      <BrandStripe />
      <div className={cx("flex h-16 items-center border-b border-white/10", collapsed ? "justify-center px-2" : "px-4")}>
        <Brand compact={collapsed} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <SidebarNav pathname={pathname} counts={counts} collapsed={collapsed} />
      </div>
      <div className="border-t border-white/10 p-3">
        {!collapsed && (
          <div className="mb-2 rounded-lg bg-white/6 px-3 py-2.5 text-xs">
            <p className="font-semibold text-white">{me.unit.name}</p>
            <p className="mt-0.5 text-on-navy-muted">{me.unit.code} · {me.role_labels[0]}{me.role_labels.length > 1 ? ` +${me.role_labels.length - 1}` : ""}</p>
          </div>
        )}
        <button onClick={onToggle} className={cx("flex h-9 w-full items-center gap-2 rounded-lg px-3 text-xs font-medium text-on-navy-muted hover:bg-white/8 hover:text-white", collapsed && "justify-center px-0")}
          aria-label={collapsed ? t("label.expand") : t("label.collapse")} aria-expanded={!collapsed}>
          {collapsed ? <ChevronsRight size={16} aria-hidden /> : <><ChevronsLeft size={16} aria-hidden />{t("label.collapse")}</>}
        </button>
      </div>
    </aside>
  );
}
