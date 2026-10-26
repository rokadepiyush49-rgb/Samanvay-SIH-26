"use client";

import { Activity, Clock, Gauge, Network } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Require } from "@/components/require";
import { PageHeader, PageSkeleton, SubNav } from "@/components/ui";
import { useApi } from "@/lib/api";
import { ago } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Meta } from "@/lib/types";
import { ScopeFilter, scopeLabel, useCockpitData, useCockpitScope } from "./scope";

function Header() {
  const { t } = useSession();
  const pathname = usePathname();
  const { query } = useCockpitScope();
  const { summary } = useCockpitData();
  const { data: meta } = useApi<Meta>("/meta");
  const items = [
    { href: "/cockpit", label: "Overview", icon: <Gauge size={15} aria-hidden /> },
    { href: "/cockpit/workload", label: "Workload & ageing", icon: <Activity size={15} aria-hidden /> },
    { href: "/cockpit/timeliness", label: "SLA & timeliness", icon: <Clock size={15} aria-hidden /> },
    { href: "/cockpit/coordination", label: "Coordination", icon: <Network size={15} aria-hidden /> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("nav.cockpit")} crumbs={[{ label: t("group.insights") }, { label: t("nav.cockpit") }]}
        description="Computed live from the case ledger. Every tile and bar opens the exact cases behind it. Sealed categories are excluded unless you are cleared."
        meta={<><span>Scope: <b className="text-ink">{scopeLabel(summary.data?.scope, meta)}</b></span>{summary.data && <span>Updated {ago(summary.data.as_of)} · refreshes every 30 s</span>}</>}
        actions={<ScopeFilter />} />
      <SubNav label="Cockpit sections" active={pathname} items={items.map((i) => ({ ...i, match: i.href, href: `${i.href}${query}` }))} />
    </div>
  );
}

export default function CockpitLayout({ children }: { children: ReactNode }) {
  return (
    <Require cap="cockpit.view">
      <Suspense fallback={<PageSkeleton />}>
        <div className="flex flex-col gap-6">
          <Header />
          {children}
        </div>
      </Suspense>
    </Require>
  );
}
