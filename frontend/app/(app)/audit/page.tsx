"use client";

import { useState } from "react";
import { IconShield } from "@/components/icons";
import { Button, Card, ErrorNote, Field, Hero, Spinner, Table, inputCls, cx } from "@/components/ui";
import { api, qs, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { hasRole, useSession } from "@/lib/session";

type Verify = { ok: boolean; entries: number; checkpoints: number; first_broken_seq: number | null; problem: string | null; public_key_id: string };
type Events = { items: { seq: number; at: string; action: string; entity_type: string | null; entity_id: string | null; payload: Record<string, unknown>; hash: string; actor: string | null; unit: string | null }[]; head_seq: number; last_checkpoint: { upto_seq: number; at: string; key_id: string } | null };

export default function AuditPage() {
  const { me } = useSession();
  const [filters, setFilters] = useState({ entity_id: "", action: "" });
  const [applied, setApplied] = useState(filters);
  const { data, error, mutate } = useApi<Events>(`/audit${qs({ ...applied, limit: 100 })}`);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [opError, setOpError] = useState<unknown>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setOpError(null);
    try { await fn(); mutate(); } catch (e) { setOpError(e); } finally { setBusy(null); }
  };
  return (
    <div className="flex flex-col gap-5">
      <Hero kicker="Audit" title="Tamper-evident history"
        side={<div className="flex flex-wrap gap-2">
          <Button variant="light" busy={busy === "verify"} onClick={() => run("verify", async () => setVerify(await api<Verify>("/audit/verify", { method: "POST" })))} arrow>Verify chain</Button>
          {hasRole(me, "SYS_ADMIN") && <Button variant="soft" busy={busy === "cp"} onClick={() => run("cp", async () => { await api("/audit/checkpoint", { method: "POST" }); })}>Sign checkpoint</Button>}
        </div>}>
        Every entry stores SHA-256(previous hash ‖ entry). Signed Merkle checkpoints (Ed25519 key held outside the database) detect a rewrite of the whole chain. No blockchain needed: AICTE is one trusted organisation.
      </Hero>
      <ErrorNote error={opError} />
      {verify && (
        <Card tone={verify.ok ? "mint" : "pink"} className="flex items-start gap-3">
          <IconShield size={28} className="shrink-0" />
          <div>
            <p className="text-xl font-extrabold">{verify.ok ? "Chain intact" : `Chain broken at entry ${verify.first_broken_seq}`}</p>
            <p className="text-sm">{verify.ok ? `${verify.entries.toLocaleString("en-IN")} entries and ${verify.checkpoints} signed checkpoints verified.` : verify.problem}</p>
            <p className="mt-1 font-mono text-[11px] opacity-80">signing key {verify.public_key_id}</p>
          </div>
        </Card>
      )}
      <form className="grid gap-3 rounded-3xl border border-rule bg-surface p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); setApplied(filters); }}>
        <Field label="Entity (case no, coordination code…)"><input className={inputCls} value={filters.entity_id} onChange={(e) => setFilters({ ...filters, entity_id: e.target.value })} /></Field>
        <Field label="Action prefix" hint="e.g. case., guard., auth.login"><input className={inputCls} value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} /></Field>
        <Button type="submit">Search</Button>
      </form>
      <ErrorNote error={error} />
      {!data ? <Spinner /> : (
        <>
          <p className="text-xs text-muted">Head entry {data.head_seq} · last checkpoint {data.last_checkpoint ? `${data.last_checkpoint.upto_seq} at ${fmtDateTime(data.last_checkpoint.at)}` : "none yet"}</p>
          <Table head={["#", "When", "Action", "Entity", "Actor", "Hash"]}>
            {data.items.map((e) => (
              <tr key={e.seq}>
                <td className="tabular text-muted">{e.seq}</td>
                <td className="whitespace-nowrap">{fmtDateTime(e.at)}</td>
                <td><span className={cx("font-mono text-xs font-bold", e.action.startsWith("guard") ? "text-pink-ink" : e.action.startsWith("coordination") ? "text-sky-ink" : "")}>{e.action}</span>
                  {Object.keys(e.payload).length > 0 && <p className="max-w-[40ch] truncate font-mono text-[11px] text-muted" title={JSON.stringify(e.payload)}>{JSON.stringify(e.payload)}</p>}</td>
                <td className="font-mono text-xs">{e.entity_id}</td>
                <td className="text-xs">{e.actor ?? "System"}{e.unit ? ` · ${e.unit}` : ""}</td>
                <td className="font-mono text-[11px] text-muted">{e.hash.slice(0, 12)}…</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}
