"use client";

import { Bell, Check, ChevronDown, ChevronRight, Languages, LogOut, Menu, RefreshCcw, Search, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu, Popover } from "radix-ui";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { initials } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Notification, NotificationList } from "@/lib/types";
import { NotificationItem } from "../notifications";
import { Button, Modal, cx } from "../ui";
import { activeItem } from "./nav";

const menuItem = "flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-surface-2";
const menuPanel = "z-50 min-w-56 rounded-xl border border-rule bg-surface p-1.5 shadow-pop";

function NotificationsPopover() {
  const { t } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data, mutate } = useApi<NotificationList>("/me/notifications?limit=8", { refreshInterval: 30000 });
  const unread = data?.unread_total ?? 0;
  const openItem = async (n: Notification) => {
    if (!n.read) await api(`/notifications/${n.id}/read`, { method: "POST" }).catch(() => undefined);
    setOpen(false);
    void mutate();
    if (n.link) router.push(n.link);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="relative grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
        aria-label={`${t("nav.notifications")}: ${unread} unread`}>
        <Bell size={19} aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-[18px] text-white ring-2 ring-surface tabular" aria-hidden>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-rule bg-surface shadow-pop focus:outline-none">
          <div className="flex items-center justify-between border-b border-rule px-4 py-3">
            <p className="text-sm font-semibold">{t("nav.notifications")} {unread > 0 && <span className="font-normal text-muted">· {unread} unread</span>}</p>
            {unread > 0 && (
              <button className="text-xs font-medium text-action hover:underline" onClick={async () => { await api("/me/notifications/read-all", { method: "POST" }).catch(() => undefined); void mutate(); }}>
                {t("action.markAllRead")}
              </button>
            )}
          </div>
          <div className="max-h-[60vh] divide-y divide-rule overflow-y-auto">
            {!data && <p className="p-6 text-center text-sm text-muted">Loading…</p>}
            {data?.items.length === 0 && <p className="p-6 text-center text-sm text-muted">You are all caught up.</p>}
            {data?.items.map((n) => <NotificationItem key={n.id} n={n} onOpen={openItem} />)}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-rule bg-surface-2/60 px-4 py-2.5 text-center text-sm font-medium text-action hover:underline">
            View all notifications
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function LanguageMenu() {
  const { lang, setLang, t } = useSession();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="hidden h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink sm:flex" aria-label={`${t("label.language")}: ${lang === "en" ? "English" : "हिन्दी"}`}>
        <Languages size={17} aria-hidden />
        <span>{lang === "en" ? "EN" : "हि"}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className={menuPanel}>
          <DropdownMenu.Label className="px-2.5 py-1.5 text-xs font-semibold text-muted">{t("label.language")}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={lang} onValueChange={(v) => setLang(v === "hi" ? "hi" : "en")}>
            {([["en", "English"], ["hi", "हिन्दी (Hindi)"]] as const).map(([v, l]) => (
              <DropdownMenu.RadioItem key={v} value={v} className={menuItem}>
                <span className="w-4">{lang === v && <Check size={15} aria-hidden />}</span>{l}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] text-muted">Menus and headings are translated; case text is shown as received.</p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ProfileMenu() {
  const { me, t, signOut, hasUnsaved } = useSession();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const doSignOut = async (force = false) => {
    if (!force && hasUnsaved()) return setConfirm(true);
    setBusy(true);
    await signOut({ force: true });
  };
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="flex h-9 items-center gap-2 rounded-lg pl-1 pr-1.5 hover:bg-surface-2 sm:pr-2" aria-label={`Account menu for ${me.full_name}`} data-testid="profile-menu">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-navy text-[11px] font-bold text-white" aria-hidden>{initials(me.full_name)}</span>
          <span className="hidden max-w-[10rem] truncate text-sm font-medium md:block">{me.full_name}</span>
          <ChevronDown size={14} className="hidden text-muted md:block" aria-hidden />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={8} className={cx(menuPanel, "w-72")}>
            <div className="px-2.5 py-2">
              <p className="text-sm font-semibold">{me.full_name}</p>
              <p className="text-xs text-muted">{me.designation ?? me.email}</p>
              <p className="mt-1.5 text-xs"><span className="font-semibold">{me.unit.code}</span> · {me.unit.name}</p>
              <p className="mt-0.5 text-xs text-muted">{me.role_labels.join(", ")}</p>
            </div>
            <DropdownMenu.Separator className="my-1 h-px bg-rule" />
            <DropdownMenu.Item asChild className={menuItem}><Link href="/settings"><UserRound size={16} aria-hidden />{t("nav.settings")}</Link></DropdownMenu.Item>
            <DropdownMenu.Item asChild className={menuItem}><Link href="/notifications"><Bell size={16} aria-hidden />{t("nav.notifications")}</Link></DropdownMenu.Item>
            {me.demo_mode && (
              <DropdownMenu.Item asChild className={menuItem}><Link href="/login?switch=1"><RefreshCcw size={16} aria-hidden />Switch role (demo)</Link></DropdownMenu.Item>
            )}
            <DropdownMenu.Separator className="my-1 h-px bg-rule" />
            <DropdownMenu.Item className={cx(menuItem, "text-danger data-[highlighted]:bg-danger-soft")} onSelect={() => void doSignOut()} data-testid="sign-out">
              <LogOut size={16} aria-hidden />{busy ? "Signing out…" : t("action.signOut")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Modal open={confirm} onClose={() => setConfirm(false)} size="sm" title="Discard unsaved changes?"
        description="A form on this page has changes that have not been saved. Signing out will discard them."
        footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Keep editing</Button><Button variant="danger" busy={busy} onClick={() => void doSignOut(true)}>Discard and sign out</Button></>} />
    </>
  );
}

export function Topbar({ pathname, onMenu, onSearch }: { pathname: string; onMenu: () => void; onSearch: () => void }) {
  const { t } = useSession();
  const ctx = activeItem(pathname);
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-rule bg-surface/95 px-3 backdrop-blur sm:gap-3 sm:px-5">
      <button className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu size={20} aria-hidden /></button>
      {ctx && (
        <p className="hidden min-w-0 items-center gap-1.5 text-sm xl:flex" aria-label="Current workspace">
          <span className="text-muted">{t(ctx.group.key)}</span>
          <ChevronRight size={14} className="text-muted" aria-hidden />
          <span className="truncate font-semibold">{t(ctx.item.key)}</span>
        </p>
      )}
      <button onClick={onSearch} className="mx-auto flex h-9 w-full max-w-md min-w-0 items-center gap-2 rounded-lg border border-rule bg-surface-2/70 px-3 text-left text-sm text-muted hover:border-rule-strong"
        aria-label="Search cases, institutions and pages (Control K)" data-testid="global-search">
        <Search size={16} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t("search.placeholder")}</span>
        <kbd className="hidden rounded border border-rule bg-surface px-1.5 text-[11px] font-medium sm:block">⌘K</kbd>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <LanguageMenu />
        <NotificationsPopover />
        <Link href="/settings" className="hidden h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink sm:grid" aria-label={t("nav.settings")}><Settings size={18} aria-hidden /></Link>
        <ProfileMenu />
      </div>
    </header>
  );
}
