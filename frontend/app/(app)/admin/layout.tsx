"use client";

import { Activity, BookOpen, ClipboardCheck, Timer, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Require } from "@/components/require";
import { PageHeader, SubNav } from "@/components/ui";
import { useSession } from "@/lib/session";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { t } = useSession();
  const pathname = usePathname();
  return (
    <Require cap="admin.view">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <PageHeader title={t("nav.admin")} crumbs={[{ label: t("group.system") }, { label: t("nav.admin") }]}
            description="Accounts and roles, versioned SLA policies, reference data and operational checks. Every change is written to the audit chain." />
          <SubNav label="Administration sections" active={pathname} items={[
            { href: "/admin", label: "System health", icon: <Activity size={15} aria-hidden /> },
            { href: "/admin/users", label: "Users & roles", icon: <Users size={15} aria-hidden /> },
            { href: "/admin/sla", label: "SLA policies", icon: <Timer size={15} aria-hidden /> },
            { href: "/admin/reference", label: "Units & reference data", icon: <BookOpen size={15} aria-hidden /> },
            { href: "/admin/access-review", label: "Access review", icon: <ClipboardCheck size={15} aria-hidden /> },
          ]} />
        </div>
        {children}
      </div>
    </Require>
  );
}
