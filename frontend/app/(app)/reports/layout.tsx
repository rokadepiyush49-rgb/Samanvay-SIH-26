"use client";

import { Archive, BarChart3, FileSpreadsheet } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Require } from "@/components/require";
import { PageHeader, PageSkeleton, SubNav } from "@/components/ui";
import { can } from "@/lib/permissions";
import { useSession } from "@/lib/session";

export default function ReportsLayout({ children }: { children: ReactNode }) {
  const { me, t } = useSession();
  const pathname = usePathname();
  const items = [
    ...(can(me, "cockpit.view") ? [{ href: "/reports", label: "Live analytics", icon: <BarChart3 size={15} aria-hidden /> }] : []),
    { href: "/reports/catalogue", label: "Report catalogue", icon: <FileSpreadsheet size={15} aria-hidden /> },
    { href: "/reports/snapshots", label: "Frozen snapshots", icon: <Archive size={15} aria-hidden /> },
  ];
  const active = pathname.startsWith("/reports/snapshots") ? "/reports/snapshots" : pathname;
  return (
    <Require cap="reports.view">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <PageHeader title={t("nav.reports")} crumbs={[{ label: t("group.insights") }, { label: t("nav.reports") }]}
            description="Live breakdowns for exploring, and frozen reports for meetings: each frozen report is computed once with a SHA-256 checksum so its numbers can be reproduced exactly later." />
          <SubNav label="Reports sections" active={active} items={items} />
        </div>
        <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
      </div>
    </Require>
  );
}
