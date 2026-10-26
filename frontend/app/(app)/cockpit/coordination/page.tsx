"use client";

import { Building2, Clock, Network, ShieldAlert, ShieldCheck, Timer } from "lucide-react";
import { ButtonLink, Card, ErrorState, KpiCard, PageSkeleton } from "@/components/ui";
import { num } from "@/lib/format";
import { useCockpitData } from "../scope";

export default function CockpitCoordination() {
  const { summary } = useCockpitData();
  if (summary.isLoading) return <PageSkeleton />;
  if (summary.error || !summary.data) return <ErrorState error={summary.error} onRetry={() => summary.mutate()} />;
  const s = summary.data;
  const k = s.kpis;
  const share = k.consequential_actions_total ? Math.round((100 * k.consequential_actions_past_undecided_overlap) / k.consequential_actions_total) : null;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label="Undecided overlaps" value={num(s.undecided_overlaps.count)} icon={<Network size={18} />} tone="coord" hint={`oldest ${s.undecided_overlaps.oldest_working_days ?? 0} working days`} href="/coordination" />
        <KpiCard label="Median alert → decision" value={k.median_alert_to_decision_hours === null ? "—" : `${k.median_alert_to_decision_hours} h`} icon={<Timer size={18} />} tone="info" hint="decided cards, last 90 days" />
        <KpiCard label="Institutions with matters in 2+ units" value={num(s.multi_unit_institutions)} icon={<Building2 size={18} />} tone="neutral" href="/institutions" />
        <KpiCard label="Consequential actions (90 days)" value={num(k.consequential_actions_total)} icon={<ShieldCheck size={18} />} tone="neutral" hint="recorded after an Action Conflict Guard check" />
        <KpiCard label="…taken past an undecided overlap" value={num(k.consequential_actions_past_undecided_overlap)} icon={<ShieldAlert size={18} />} tone="danger" hint={share === null ? "no actions yet" : `${share}% of consequential actions, each with a recorded reason`} />
        <KpiCard label="Guard → “coordinate first”" value={num(k.coordination_opened_from_guard)} icon={<Clock size={18} />} tone="ok" hint="actions paused to coordinate" />
      </div>
      <Card title="How to read these numbers">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>An overlap is a link the matching engine proposed between cases of different units on the same institution. It is evidence for review, not a confirmed duplicate.</li>
          <li>“Taken past an undecided overlap” counts officers who chose <i>Proceed and notify</i> in the Action Conflict Guard. Each has a reason in the audit chain.</li>
          <li>Undecided cards escalate to the nodal officer after 3 working days.</li>
        </ul>
        <div className="mt-4"><ButtonLink href="/coordination" variant="secondary" icon={<Network size={15} aria-hidden />}>Open the Coordination Centre</ButtonLink></div>
      </Card>
    </div>
  );
}
