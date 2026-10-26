"use client";

import Link from "next/link";
import { fmtDate, label } from "@/lib/format";
import type { Reason } from "@/lib/types";
import { ReasonList } from "./cases";
import { Badge, TypeBadge, cx } from "./ui";

export type Side = {
  case_id: string; case_no: string; status: string; status_label: string; unit: string; officer: string | null;
  category: string; received_on: string; holder_since: string; subject?: string | null; body?: string | null;
};

export type CardT = {
  id: string; code: string; status: string; decision: string | null; lead_unit: string | null; phrase: string; type: string; type_label: string;
  probability: number; reasons: Reason[]; decide_by: string; working_days_left: number; proposal: Record<string, string | null> | null; row_version: number;
  institution: { name: string | null; permanent_id: string | null; city: string | null }; a: Side; b: Side; participant: boolean; awaiting_me: boolean; can_decide: boolean;
};

export function CoordinationCard({ card }: { card: CardT }) {
  const open = card.status !== "DECIDED";
  return (
    <Link href={`/coordination/${card.code}`} className={cx("block rounded-3xl p-5 transition", card.type === "P" && open ? "bg-pink text-pink-ink" : open ? "bg-yellow text-yellow-ink" : "border border-rule bg-surface text-ink")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {open && <p className="text-xs font-bold uppercase tracking-wide">{card.phrase}</p>}
          <p className="mt-1 text-lg font-extrabold leading-tight">{card.institution.name ?? "Institution unconfirmed"}</p>
          <p className="text-xs opacity-80">{card.institution.city} · {card.institution.permanent_id} · <span className="font-mono">{card.code}</span></p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <TypeBadge type={card.type} prob={card.probability} />
          {card.awaiting_me && <Badge tone="danger">● awaiting your confirmation</Badge>}
          {card.status === "ESCALATED" && <Badge tone="danger">↑ escalated</Badge>}
          {card.status === "DECIDED" && <Badge tone="ok">✓ {label(card.decision)}{card.lead_unit ? `, ${card.lead_unit} leads` : ""}</Badge>}
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {[card.a, card.b].map((s) => (
          <div key={s.case_id} className="rounded-2xl bg-surface/70 p-3 text-ink">
            <p className="text-sm"><b>{s.unit}</b> · <span className="font-mono">{s.case_no}</span></p>
            <p className="text-xs text-muted">{s.status_label} · {s.category}</p>
            <p className="text-xs text-muted">holder {s.officer ?? "unassigned"} since {fmtDate(s.holder_since)}</p>
          </div>
        ))}
      </div>
      <div className="mt-3"><ReasonList reasons={card.reasons} compact /></div>
      {open && <p className="mt-3 text-xs font-semibold">Decide by {fmtDate(card.decide_by)} ({card.working_days_left} working days)</p>}
    </Link>
  );
}
