"use client";

import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { Dialog, Tooltip } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";
import { useApi } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import type { CoordinationList, NotificationList, Transfer } from "@/lib/types";
import { Brand, BrandStripe } from "./shell/brand";
import { CommandPalette } from "./shell/command-palette";
import { Sidebar, SidebarNav, type NavCounts } from "./shell/sidebar";
import { Topbar } from "./shell/topbar";

function useNavCounts(): NavCounts {
  const { me } = useSession();
  const opts = { refreshInterval: 60000, revalidateOnFocus: false };
  const { data: coord } = useApi<CoordinationList>(can(me, "coordination.decide") ? "/coordination?status=open&mine=true&limit=200" : null, opts);
  const { data: transfers } = useApi<{ items: Transfer[] }>(can(me, "transfers.decide") ? "/transfers?direction=incoming&state=open&limit=100" : null, opts);
  const { data: notes } = useApi<NotificationList>("/me/notifications?limit=8", { refreshInterval: 30000 });
  return { coordination: coord?.counts.awaiting_me, transfers: transfers?.items.length, notifications: notes?.unread_total };
}

export function Shell({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const pathname = usePathname();
  const counts = useNavCounts();
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("smv_sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("smv_sidebar", c ? "open" : "collapsed");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Tooltip.Provider delayDuration={250}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop">Skip to main content</a>
      <div className="flex min-h-screen">
        <Sidebar pathname={pathname} counts={counts} collapsed={collapsed} onToggle={toggle} />
        <Dialog.Root open={drawer} onOpenChange={setDrawer}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 lg:hidden" />
            <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col bg-navy text-on-navy shadow-pop focus:outline-none lg:hidden">
              <Dialog.Title className="sr-only">Navigation</Dialog.Title>
              <BrandStripe />
              <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
                <Brand />
                <Dialog.Close className="rounded-md p-1.5 text-on-navy-muted hover:bg-white/10 hover:text-white" aria-label="Close navigation"><X size={18} /></Dialog.Close>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4"><SidebarNav pathname={pathname} counts={counts} onNavigate={() => setDrawer(false)} /></div>
              <p className="border-t border-white/10 px-4 py-3 text-xs text-on-navy-muted">{me.unit.code} · {me.full_name}</p>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar pathname={pathname} onMenu={() => setDrawer(true)} onSearch={() => setPalette(true)} />
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8">{children}</main>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-rule px-4 py-3 text-xs text-muted sm:px-8">
            <span>Samanvay v0.2 · AICTE · One ledger. Explainable overlap detection. Coordinated action.</span>
            <span className="rounded bg-warn-soft px-2 py-0.5 font-medium text-warn-ink">All records are synthetic demo data</span>
          </footer>
        </div>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </Tooltip.Provider>
  );
}
