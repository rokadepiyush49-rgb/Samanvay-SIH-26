"use client";

import { useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, ErrorNote, ErrorState, Field, Modal, Table, TableSkeleton, cx, inputCls } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { label } from "@/lib/format";

type Policy = { id: number; code: string; version: number; name: string; channel: string | null; category_group: string | null; day_basis: string; target_days: number; reminder_offsets: number[]; interim_reply_day: number | null; escalate_after_days: number; approval_status: string; is_active: boolean };

export default function AdminSla() {
  const toast = useToast();
  const { data, error, mutate } = useApi<{ items: Policy[] }>("/sla-policies");
  const [form, setForm] = useState({ code: "", target_days: 30, day_basis: "WORKING" });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<unknown>(null);
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  const base = data?.items.find((p) => p.code === form.code && p.is_active);
  const save = async () => {
    setBusy(true);
    setOpError(null);
    try {
      await api("/sla-policies", { json: { code: form.code, name: base?.name ?? form.code, channel: base?.channel ?? null, category_group: base?.category_group ?? null,
        day_basis: form.day_basis, target_days: Number(form.target_days), reminder_offsets: base?.reminder_offsets ?? [3, 1],
        interim_reply_day: base?.interim_reply_day ?? null, escalate_after_days: base?.escalate_after_days ?? 5 } });
      toast({ kind: "success", title: `${form.code} v${(base?.version ?? 0) + 1} created`, detail: "New cases use it; existing cases keep their version." });
      setConfirm(false);
      void mutate();
    } catch (e) {
      setOpError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Card title="New policy version" description="Versions are immutable. A new version applies to cases registered after it; existing cases keep theirs. Timelines are proposed until AICTE approves them.">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_170px_auto] sm:items-end">
          <Field id="sla-code" label="Policy">
            <select id="sla-code" className={inputCls} value={form.code} onChange={(e) => { const p = data?.items.find((x) => x.code === e.target.value && x.is_active); setForm({ code: e.target.value, target_days: p?.target_days ?? 30, day_basis: p?.day_basis ?? "WORKING" }); }}>
              <option value="">Choose a policy</option>{[...new Set((data?.items ?? []).map((p) => p.code))].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field id="sla-days" label="Target days"><input id="sla-days" type="number" min={1} max={365} className={inputCls} value={form.target_days} onChange={(e) => setForm({ ...form, target_days: Number(e.target.value) })} /></Field>
          <Field id="sla-basis" label="Day basis"><select id="sla-basis" className={inputCls} value={form.day_basis} onChange={(e) => setForm({ ...form, day_basis: e.target.value })}><option value="WORKING">Working days</option><option value="CALENDAR">Calendar days</option></select></Field>
          <Button disabled={!form.code || form.target_days < 1} onClick={() => setConfirm(true)}>Create version</Button>
        </div>
        <div className="mt-3"><ErrorNote error={opError} /></div>
      </Card>
      {!data ? <TableSkeleton rows={6} /> : (
        <Table caption="SLA policies" head={["Policy", "Applies to", "Target", "Reminders (days before)", "Interim reply", "Escalate after", "Status"]}>
          {data.items.map((p) => (
            <tr key={p.id} className={cx(!p.is_active && "opacity-60")}>
              <td><p className="font-semibold">{p.code} v{p.version}</p><p className="text-xs text-muted">{p.name}</p></td>
              <td className="text-xs">{[p.channel, p.category_group].filter(Boolean).join(" · ") || "Everything else"}</td>
              <td className="tabular">{p.target_days} {p.day_basis === "WORKING" ? "working" : "calendar"} days</td>
              <td className="tabular">{p.reminder_offsets.join(", ")}</td>
              <td className="tabular">{p.interim_reply_day ? `day ${p.interim_reply_day}` : "—"}</td>
              <td className="tabular">+{p.escalate_after_days} days</td>
              <td>{p.is_active ? <Badge tone="warn">{label(p.approval_status)}</Badge> : <Badge>Superseded</Badge>}</td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} size="sm" title={`Create ${form.code} v${(base?.version ?? 0) + 1}?`}
        description={`${form.target_days} ${form.day_basis === "WORKING" ? "working" : "calendar"} days. Other settings are copied from the current version.`}
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button busy={busy} onClick={save}>Create version</Button></>} />
    </div>
  );
}
