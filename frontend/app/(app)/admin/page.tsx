"use client";

import { useState } from "react";
import { Badge, Button, Card, ErrorNote, Field, PageHead, Spinner, Table, Tabs, inputCls } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { fmtDateTime, label } from "@/lib/format";

type User = { id: string; email: string; full_name: string; designation: string | null; roles: string[]; sealed_clearance: boolean; is_active: boolean; last_login_at: string | null; unit: string };
type Policy = { id: number; code: string; version: number; name: string; channel: string | null; category_group: string | null; day_basis: string; target_days: number; reminder_offsets: number[]; interim_reply_day: number | null; escalate_after_days: number; approval_status: string; is_active: boolean };
type Health = { orphan_open_cases: number; orphan_examples: string[]; stuck_transfers: number; unmatched_open_cases: number; jobs: Record<string, number>; dead_jobs: { id: number; kind: string; error: string }[] };

function Users() {
  const { data, mutate } = useApi<{ items: User[] }>("/admin/users");
  const [error, setError] = useState<unknown>(null);
  const toggle = async (u: User) => {
    try {
      await api(`/admin/users/${u.id}`, { method: "PATCH", json: { is_active: !u.is_active } });
      mutate();
    } catch (e) {
      setError(e);
    }
  };
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote error={error} />
      <Table head={["Official", "Unit", "Roles", "Sealed clearance", "Last sign-in", ""]}>
        {data.items.map((u) => (
          <tr key={u.id}>
            <td><p className="font-semibold">{u.full_name}</p><p className="text-xs text-muted">{u.email}</p></td>
            <td className="font-bold">{u.unit}</td>
            <td><span className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r}>{label(r)}</Badge>)}</span></td>
            <td>{u.sealed_clearance ? <Badge tone="warn">cleared</Badge> : "—"}</td>
            <td className="text-xs">{fmtDateTime(u.last_login_at)}</td>
            <td><Button variant={u.is_active ? "soft" : "primary"} onClick={() => toggle(u)}>{u.is_active ? "Disable" : "Enable"}</Button></td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Policies() {
  const { data, mutate } = useApi<{ items: Policy[] }>("/sla-policies");
  const [form, setForm] = useState({ code: "", target_days: 30, day_basis: "WORKING" });
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    const base = data?.items.find((p) => p.code === form.code && p.is_active);
    try {
      await api("/sla-policies", { json: { code: form.code, name: base?.name ?? form.code, channel: base?.channel ?? null, category_group: base?.category_group ?? null,
        day_basis: form.day_basis, target_days: Number(form.target_days), reminder_offsets: base?.reminder_offsets ?? [3, 1],
        interim_reply_day: base?.interim_reply_day ?? null, escalate_after_days: base?.escalate_after_days ?? 5 } });
      mutate();
    } catch (e) {
      setError(e);
    }
  };
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      <Card tone="cream" className="grid gap-3 sm:grid-cols-[1fr_140px_160px_auto] sm:items-end">
        <Field label="Policy code" hint="Creates a new version; existing cases keep theirs">
          <select className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}>
            <option value="">Choose</option>{[...new Set(data.items.map((p) => p.code))].map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Target days"><input type="number" min={1} max={365} className={inputCls} value={form.target_days} onChange={(e) => setForm({ ...form, target_days: Number(e.target.value) })} /></Field>
        <Field label="Basis"><select className={inputCls} value={form.day_basis} onChange={(e) => setForm({ ...form, day_basis: e.target.value })}><option value="WORKING">Working days</option><option value="CALENDAR">Calendar days</option></select></Field>
        <Button disabled={!form.code} onClick={save}>New version</Button>
      </Card>
      <ErrorNote error={error} />
      <Table head={["Policy", "Applies to", "Target", "Reminders", "Interim", "Escalate", "Status"]}>
        {data.items.map((p) => (
          <tr key={p.id} className={p.is_active ? "" : "opacity-50"}>
            <td><p className="font-bold">{p.code} v{p.version}</p><p className="text-xs text-muted">{p.name}</p></td>
            <td className="text-xs">{[p.channel, p.category_group].filter(Boolean).join(" · ") || "everything else"}</td>
            <td className="tabular">{p.target_days} {p.day_basis === "WORKING" ? "wd" : "days"}</td>
            <td className="tabular">{p.reminder_offsets.join(", ")}</td>
            <td className="tabular">{p.interim_reply_day ?? "—"}</td>
            <td className="tabular">+{p.escalate_after_days}</td>
            <td>{p.is_active ? <Badge tone="warn">{label(p.approval_status)}</Badge> : <Badge>superseded</Badge>}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function HealthView() {
  const { data } = useApi<Health>("/admin/health", { refreshInterval: 15000 });
  if (!data) return <Spinner />;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card tone={data.orphan_open_cases ? "pink" : "mint"}><p className="text-sm font-bold">Open cases without a custodian</p><p className="text-4xl font-extrabold tabular">{data.orphan_open_cases}</p><p className="text-xs">target: zero</p></Card>
      <Card tone={data.stuck_transfers ? "yellow" : "mint"}><p className="text-sm font-bold">Transfers waiting &gt; 7 days</p><p className="text-4xl font-extrabold tabular">{data.stuck_transfers}</p></Card>
      <Card tone="sky"><p className="text-sm font-bold">Open cases not yet matched</p><p className="text-4xl font-extrabold tabular">{data.unmatched_open_cases}</p></Card>
      <Card tone={(data.jobs.DEAD ?? 0) ? "pink" : "cream"}><p className="text-sm font-bold">Job queue</p><p className="text-sm">{Object.entries(data.jobs).map(([k, v]) => `${label(k)} ${v}`).join(" · ")}</p>
        {data.dead_jobs.map((j) => <p key={j.id} className="mt-1 font-mono text-[11px]">{j.kind}: {j.error}</p>)}</Card>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<"health" | "users" | "sla">("health");
  return (
    <div className="flex flex-col gap-5">
      <PageHead title="Administration">Users and roles, versioned SLA policies, and operational invariants. Every change is written to the audit chain.</PageHead>
      <Tabs value={tab} onChange={setTab} items={[{ value: "health", label: "System health" }, { value: "users", label: "Users & roles" }, { value: "sla", label: "SLA policies" }]} />
      {tab === "health" && <HealthView />}
      {tab === "users" && <Users />}
      {tab === "sla" && <Policies />}
    </div>
  );
}
