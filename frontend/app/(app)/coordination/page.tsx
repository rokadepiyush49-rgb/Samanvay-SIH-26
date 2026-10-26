"use client";

import { useState } from "react";
import { CoordinationCard, type CardT } from "@/components/coordination";
import { Stagger, StaggerItem } from "@/components/motion";
import { Empty, ErrorNote, Hero, Spinner, Tabs } from "@/components/ui";
import { useApi } from "@/lib/api";

export default function CoordinationPage() {
  const [status, setStatus] = useState<"open" | "decided" | "escalated" | "all">("open");
  const { data, error, isLoading, mutate } = useApi<{ items: CardT[]; counts: { awaiting_me: number; parallel: number; escalated: number } }>(`/coordination?status=${status}&limit=100`, { refreshInterval: 30000 });
  return (
    <div className="flex flex-col gap-5">
      <Hero kicker="Coordination Centre" title="Decide together, before anyone acts.">
        Each card links two cases about the same institution, with the reasons. One unit proposes duplicate / related (with a lead unit) or not related;
        the other confirms. Cards undecided for 3 working days escalate to the nodal officer.
      </Hero>
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-3xl bg-pink p-4 text-pink-ink"><p className="text-sm font-bold">Parallel action</p><p className="text-3xl font-extrabold tabular">{data.counts.parallel}</p></div>
          <div className="rounded-3xl bg-yellow p-4 text-yellow-ink"><p className="text-sm font-bold">Awaiting you</p><p className="text-3xl font-extrabold tabular">{data.counts.awaiting_me}</p></div>
          <div className="rounded-3xl bg-sky p-4 text-sky-ink"><p className="text-sm font-bold">Escalated</p><p className="text-3xl font-extrabold tabular">{data.counts.escalated}</p></div>
        </div>
      )}
      <Tabs value={status} onChange={setStatus} items={[{ value: "open", label: "Needs decision" }, { value: "escalated", label: "Escalated" }, { value: "decided", label: "Decided" }, { value: "all", label: "All" }]} />
      {isLoading && <Spinner />}
      <ErrorNote error={error} onRetry={() => mutate()} />
      {data && (data.items.length === 0 ? <Empty title="No overlaps need a decision." /> : (
        <Stagger className="grid gap-4 lg:grid-cols-2">
          {data.items.map((c) => <StaggerItem key={c.id}><CoordinationCard card={c} /></StaggerItem>)}
        </Stagger>
      ))}
    </div>
  );
}
