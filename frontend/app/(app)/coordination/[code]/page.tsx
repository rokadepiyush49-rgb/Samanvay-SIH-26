"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ReasonList } from "@/components/cases";
import { FadeIn } from "@/components/motion";
import { Badge, Button, Card, ErrorNote, Field, Spinner, TypeBadge, inputCls, cx } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { fmtDate, fmtDateTime, label } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { CardT } from "@/components/coordination";

type Room = CardT & { messages: { id: string; body: string; at: string; author: string; unit: string }[]; units: string[] };

export default function CoordinationRoom() {
  const { code } = useParams<{ code: string }>();
  const { me } = useSession();
  const { data: c, error, mutate, isLoading } = useApi<Room>(`/coordination/${code}`, { refreshInterval: 20000 });
  const [decision, setDecision] = useState<"RELATED" | "DUPLICATE" | "NOT_RELATED">("RELATED");
  const [lead, setLead] = useState("");
  const [jointAction, setJointAction] = useState("");
  const [jointDue, setJointDue] = useState("");
  const [remarks, setRemarks] = useState("");
  const [msg, setMsg] = useState("");
  const [opError, setOpError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (isLoading) return <Spinner />;
  if (error || !c) return <ErrorNote error={error} onRetry={() => mutate()} />;

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setOpError(null);
    try {
      await fn();
      await mutate();
    } catch (e) {
      setOpError(e);
    } finally {
      setBusy(null);
    }
  };
  const propose = () => act("propose", () => api(`/coordination/${c.code}/decision`, {
    json: { decision, lead_unit: decision === "NOT_RELATED" ? null : lead || null, joint_next_action: jointAction || null, joint_due: jointDue || null, remarks: remarks || null },
    headers: { "if-match": String(c.row_version) },
  }));
  const p = c.proposal;
  const mineProposed = p?.by_unit === me?.unit.code && c.a.unit !== c.b.unit;

  return (
    <FadeIn className="flex flex-col gap-5">
      <section className={cx("rounded-[2rem] p-6 sm:p-8", c.status === "DECIDED" ? "bg-mint text-mint-ink" : "bg-navy text-on-navy")}>
        <p className={cx("text-xs font-bold uppercase tracking-[0.14em]", c.status === "DECIDED" ? "" : "text-pink")}>{c.status === "DECIDED" ? "Decided" : c.phrase}</p>
        <h1 className={cx("mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl", c.status !== "DECIDED" && "text-white")}>{c.institution.name ?? "Institution unconfirmed"}</h1>
        <p className="mt-1 text-sm opacity-90"><span className="font-mono">{c.code}</span> · {c.institution.city} · {c.institution.permanent_id} · {c.status === "DECIDED" ? `${label(c.decision)}${c.lead_unit ? `, ${c.lead_unit} leads` : ""}` : `decide by ${fmtDate(c.decide_by)} (${c.working_days_left} working days)`}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2"><TypeBadge type={c.type} prob={c.probability} />{c.status === "ESCALATED" && <Badge tone="danger">↑ escalated to nodal officer</Badge>}</div>
        <div className="mt-4"><ReasonList reasons={c.reasons} /></div>
      </section>
      <ErrorNote error={opError} />

      <div className="grid gap-4 lg:grid-cols-2">
        {[c.a, c.b].map((s) => (
          <Card key={s.case_id}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">{s.unit}</p>
                <Link href={`/cases/${s.case_no}`} className="font-mono text-lg font-bold underline-offset-2 hover:underline">{s.case_no}</Link>
              </div>
              <Badge tone="info">{s.status_label}</Badge>
            </div>
            <p className="mt-1 text-sm">{s.category} · received {fmtDate(s.received_on)} · holder {s.officer ?? "unassigned"}</p>
            {s.body ? <p className="mt-3 line-clamp-6 whitespace-pre-wrap rounded-2xl bg-surface-2 p-3 text-sm">{s.body}</p>
              : <p className="mt-3 text-xs text-muted">Content visible to participating units.</p>}
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card tone="cream" className="flex flex-col gap-4">
          <h2 className="text-lg font-extrabold">Decision</h2>
          {c.status === "DECIDED" ? (
            <p className="text-sm">Decided: <b>{label(c.decision)}</b>{c.lead_unit && <> · lead unit <b>{c.lead_unit}</b></>}{p?.joint_next_action && <> · joint action “{p.joint_next_action}”{p.joint_due ? ` by ${fmtDate(p.joint_due)}` : ""}</>}. Both case histories record it.</p>
          ) : (
            <>
              {p && c.status === "AWAITING_CONFIRMATION" && (
                <div className="rounded-2xl bg-surface p-4 text-sm">
                  <p className="font-bold">{p.by_unit} proposed: {label(p.decision)}{p.lead_unit ? `, ${p.lead_unit} leads` : ""}</p>
                  {p.joint_next_action && <p>Joint action: {p.joint_next_action}{p.joint_due ? ` by ${fmtDate(p.joint_due)}` : ""}</p>}
                  {p.remarks && <p className="text-muted">“{p.remarks}” — {p.by}</p>}
                  {c.awaiting_me ? (
                    <div className="mt-3 flex gap-2"><Button busy={busy === "confirm"} onClick={() => act("confirm", () => api(`/coordination/${c.code}/confirm`, { method: "POST", headers: { "if-match": String(c.row_version) } }))} arrow>Confirm decision</Button></div>
                  ) : mineProposed ? <p className="mt-2 text-xs text-muted">Waiting for the other unit to confirm.</p> : null}
                </div>
              )}
              {c.can_decide && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted">{p ? "Or propose a different decision:" : "Propose a decision; the other unit confirms."}</p>
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Decision">
                    {([["RELATED", "Related", "Same matter, different complainants"], ["DUPLICATE", "Duplicate", "Same complaint; the other case follows the lead"], ["NOT_RELATED", "Not related", "Reason required; pair is silenced"]] as const).map(([v, t, d]) => (
                      <button key={v} role="radio" aria-checked={decision === v} onClick={() => setDecision(v)}
                        className={cx("rounded-2xl border p-3 text-left text-sm", decision === v ? "border-navy bg-surface ring-2 ring-navy" : "border-rule bg-surface/60")}>
                        <span className="block font-bold">{t}</span><span className="text-xs text-muted">{d}</span>
                      </button>
                    ))}
                  </div>
                  {decision !== "NOT_RELATED" && (
                    <Field label="Lead unit" required>
                      <div className="flex gap-2">{c.units.map((u) => (
                        <button key={u} onClick={() => setLead(u)} aria-pressed={lead === u} className={cx("rounded-full px-5 py-2 text-sm font-bold", lead === u ? "bg-navy text-white" : "bg-surface")}>{u}</button>
                      ))}</div>
                    </Field>
                  )}
                  {decision !== "NOT_RELATED" && (
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
                      <Field label="Joint next action"><input className={inputCls} value={jointAction} onChange={(e) => setJointAction(e.target.value)} placeholder="e.g. Consolidated reply to complainant" /></Field>
                      <Field label="Joint deadline"><input type="date" className={inputCls} value={jointDue} onChange={(e) => setJointDue(e.target.value)} /></Field>
                    </div>
                  )}
                  <Field label="Remarks" required={decision === "NOT_RELATED"}><textarea className={cx(inputCls, "min-h-20")} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
                  <div className="flex flex-wrap justify-between gap-2">
                    <Button variant="ghost" onClick={() => { const r = window.prompt("Why escalate?"); if (r) act("esc", () => api(`/coordination/${c.code}/escalate`, { json: { reason: r } })); }}>Escalate</Button>
                    <Button busy={busy === "propose"} disabled={(decision !== "NOT_RELATED" && !lead) || (decision === "NOT_RELATED" && !remarks.trim())} onClick={propose} arrow>
                      {c.status === "ESCALATED" ? "Decide" : "Propose decision"}
                    </Button>
                  </div>
                </div>
              )}
              {!c.can_decide && !c.awaiting_me && <p className="text-sm text-muted">You can follow this coordination; the two units decide it.</p>}
            </>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-extrabold">Coordination room</h2>
          <p className="text-xs text-muted">Visible to {c.units.join(" and ")} and oversight roles only.</p>
          <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {c.messages.length === 0 && <li className="text-sm text-muted">No messages yet.</li>}
            {c.messages.map((m) => (
              <li key={m.id} className={cx("rounded-2xl p-3 text-sm", m.unit === me?.unit.code ? "ml-6 bg-sky text-sky-ink" : "mr-6 bg-surface-2")}>
                <p>{m.body}</p><p className="mt-1 text-[11px] opacity-70">{m.author} · {m.unit} · {fmtDateTime(m.at)}</p>
              </li>
            ))}
          </ul>
          {c.participant || c.can_decide ? (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) act("msg", async () => { await api(`/coordination/${c.code}/messages`, { json: { body: msg } }); setMsg(""); }); }}>
              <input className={inputCls} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Write to the other unit" aria-label="Message" />
              <Button type="submit" busy={busy === "msg"}>Send</Button>
            </form>
          ) : null}
        </Card>
      </div>
    </FadeIn>
  );
}
