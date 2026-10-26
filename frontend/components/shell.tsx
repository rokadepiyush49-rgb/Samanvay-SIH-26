"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, useApi } from "@/lib/api";
import { ago } from "@/lib/format";
import { useSession } from "@/lib/session";
import {
  IconBell, IconBuilding, IconCases, IconChart, IconDesk, IconGauge, IconGear, IconLink, IconLogout, IconMenu,
  IconReport, IconSearch, IconShield, IconUpload, IconX,
} from "./icons";
import { cx } from "./ui";

const CASE_VIEW = ["INTAKE_OFFICER", "CASE_OFFICER", "UNIT_HEAD", "REGIONAL_OFFICER", "SENIOR_MGMT", "COMPETENT_AUTHORITY", "NODAL_OFFICER", "AUDITOR"];
const NAV = [
  { href: "/desk", key: "desk", icon: IconDesk, roles: ["INTAKE_OFFICER", "CASE_OFFICER", "UNIT_HEAD", "REGIONAL_OFFICER"] },
  { href: "/coordination", key: "coordination", icon: IconLink, roles: ["CASE_OFFICER", "UNIT_HEAD", "REGIONAL_OFFICER", "SENIOR_MGMT", "COMPETENT_AUTHORITY", "NODAL_OFFICER", "AUDITOR"] },
  { href: "/cases", key: "cases", icon: IconCases, roles: CASE_VIEW },
  { href: "/institutions", key: "institutions", icon: IconBuilding, roles: [...CASE_VIEW, "DATA_STEWARD"] },
  { href: "/cockpit", key: "cockpit", icon: IconGauge, roles: ["UNIT_HEAD", "REGIONAL_OFFICER", "SENIOR_MGMT", "COMPETENT_AUTHORITY"] },
  { href: "/reports", key: "reports", icon: IconReport, roles: ["UNIT_HEAD", "REGIONAL_OFFICER", "SENIOR_MGMT", "COMPETENT_AUTHORITY", "AUDITOR"] },
  { href: "/imports", key: "imports", icon: IconUpload, roles: ["INTAKE_OFFICER", "CASE_OFFICER", "UNIT_HEAD", "REGIONAL_OFFICER"] },
  { href: "/benchmark", key: "benchmark", icon: IconChart, roles: ["UNIT_HEAD", "REGIONAL_OFFICER", "SENIOR_MGMT", "COMPETENT_AUTHORITY", "SYS_ADMIN", "AUDITOR", "DATA_STEWARD", "CASE_OFFICER"] },
  { href: "/admin", key: "admin", icon: IconGear, roles: ["SYS_ADMIN"] },
  { href: "/audit", key: "audit", icon: IconShield, roles: ["SYS_ADMIN", "AUDITOR"] },
];

type Notifications = {
  items: { id: string; family: string; severity: string; title: string; body: string; link: string | null; created_at: string; read: boolean }[];
  unread_total: number;
};

function Bell() {
  const [open, setOpen] = useState(false);
  const { data, mutate } = useApi<Notifications>("/me/notifications?limit=15", { refreshInterval: 30000 });
  const { t } = useSession();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const go = async (n: Notifications["items"][number]) => {
    if (!n.read) await api(`/notifications/${n.id}/read`, { method: "POST" }).catch(() => undefined);
    setOpen(false);
    mutate();
    if (n.link) router.push(n.link);
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${t("notifications")}: ${data?.unread_total ?? 0} unread`}
        className="relative grid h-10 w-10 place-items-center rounded-full bg-surface-2 hover:bg-rule/70">
        <IconBell size={19} />
        {!!data?.unread_total && (
          <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-pink px-1 text-center text-[11px] font-bold leading-5 text-pink-ink tabular">
            {data.unread_total > 99 ? "99+" : data.unread_total}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-rule bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-rule px-4 py-3">
            <p className="font-bold">{t("notifications")}</p>
            <button className="text-xs font-semibold text-muted hover:text-ink"
              onClick={async () => { await api("/me/notifications/read-all", { method: "POST" }); mutate(); }}>Mark all read</button>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {(data?.items ?? []).length === 0 && <li className="p-6 text-center text-sm text-muted">No notifications yet.</li>}
            {data?.items.map((n) => (
              <li key={n.id}>
                <button onClick={() => go(n)} className={cx("flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-2", !n.read && "bg-cream")}>
                  <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.severity === "CRITICAL" ? "bg-pink-ink" : n.severity === "WARNING" ? "bg-yellow-ink" : "bg-sky-ink")} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-snug">{n.title}</span>
                    {n.body && <span className="mt-0.5 block text-xs text-muted">{n.body}</span>}
                    <span className="mt-1 block text-[11px] uppercase tracking-wide text-muted">{n.family} · {ago(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { me, lang, setLang, t } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const [loadedAt] = useState(() => new Date().toISOString());
  if (!me) return null;
  const items = NAV.filter((n) => n.roles.some((r) => me.roles.includes(r)));
  const signOut = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  };
  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map(({ href, key, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} onClick={() => setMenu(false)} aria-current={active ? "page" : undefined}
            className={cx("flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition", active ? "bg-navy text-white" : "text-muted hover:bg-surface-2 hover:text-ink")}>
            <Icon size={19} />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="hidden border-r border-rule bg-surface px-4 py-5 lg:flex lg:flex-col lg:gap-6">
        <Brand />
        {nav}
        <div className="mt-auto rounded-2xl bg-surface-2 p-3 text-xs">
          <p className="font-bold">{me.full_name}</p>
          <p className="text-muted">{me.designation}</p>
          <p className="mt-1 font-semibold text-sky-ink">{me.unit.code} · {me.role_labels.join(", ")}</p>
        </div>
      </aside>
      {menu && (
        <div className="fixed inset-0 z-50 bg-[#0b0d24]/50 lg:hidden" onClick={() => setMenu(false)}>
          <div className="h-full w-72 bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between"><Brand /><button onClick={() => setMenu(false)} aria-label="Close menu"><IconX /></button></div>
            {nav}
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-rule bg-page/90 px-4 py-3 backdrop-blur sm:gap-3 sm:px-6">
          <button className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu"><IconMenu /></button>
          <form className="relative min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/cases?q=${encodeURIComponent(q.trim())}`); }}>
            <IconSearch size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label="Search cases"
              className="w-full rounded-full border border-rule bg-surface py-2.5 pl-10 pr-4 text-sm focus:border-[var(--focus)] focus:outline-none" />
          </form>
          <button onClick={() => setLang(lang === "en" ? "hi" : "en")} className="h-10 shrink-0 rounded-full bg-surface-2 px-3 text-sm font-semibold" aria-label="Switch language">
            {lang === "en" ? "हिन्दी" : "English"}
          </button>
          <Bell />
          {me.demo_mode && (
            <Link href="/login?switch=1" className="hidden h-10 shrink-0 items-center rounded-full bg-yellow px-4 text-sm font-semibold text-yellow-ink sm:inline-flex">Switch role</Link>
          )}
          <button onClick={signOut} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2" aria-label={t("signOut")} title={t("signOut")}><IconLogout size={19} /></button>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
        <footer className="border-t border-rule px-6 py-3 text-xs text-muted">
          {t("updated")} {ago(loadedAt, now)} · Samanvay v0.1 · synthetic demo data only · {me.unit.name}
        </footer>
      </div>
    </div>
  );
}

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-2xl bg-navy text-lg font-black text-white" aria-hidden>स</span>
      <span className="leading-tight">
        <span className="block text-lg font-extrabold tracking-tight">Samanvay</span>
        <span className="block text-[11px] font-semibold text-muted">AICTE coordination ledger</span>
      </span>
    </Link>
  );
}
