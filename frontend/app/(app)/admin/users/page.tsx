"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { useToast } from "@/components/toast";
import { Badge, Button, ErrorNote, ErrorState, Field, Modal, Table, TableSkeleton, cx, fieldA11y, inputCls } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { fmtDateTime, label } from "@/lib/format";
import type { Meta } from "@/lib/types";

type User = { id: string; email: string; full_name: string; designation: string | null; roles: string[]; sealed_clearance: boolean; is_active: boolean; last_login_at: string | null; unit: string };
const ROLES = ["INTAKE_OFFICER", "CASE_OFFICER", "UNIT_HEAD", "REGIONAL_OFFICER", "SENIOR_MGMT", "COMPETENT_AUTHORITY", "NODAL_OFFICER", "DATA_STEWARD", "SYS_ADMIN", "AUDITOR"];

const newUserSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the official's full name."),
  email: z.string().trim().email("Enter a valid official e-mail."),
  designation: z.string().max(120),
  unit: z.string().min(1, "Choose a unit."),
  roles: z.array(z.string()).min(1, "Choose at least one role."),
  password: z.string().min(12, "Initial password must be at least 12 characters."),
  sealed_clearance: z.boolean(),
});
type NewUser = z.infer<typeof newUserSchema>;

function RolePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="grid gap-1.5 sm:grid-cols-2">
      <legend className="mb-1.5 text-sm font-medium">Roles</legend>
      {ROLES.map((r) => (
        <label key={r} className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--action)]" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />{label(r)}
        </label>
      ))}
    </fieldset>
  );
}

function CreateUser({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { data: meta } = useApi<Meta>(open ? "/meta" : null);
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, setValue, control, reset, formState: { errors, isSubmitting } } = useForm<NewUser>({
    resolver: zodResolver(newUserSchema), defaultValues: { full_name: "", email: "", designation: "", unit: "", roles: [], password: "", sealed_clearance: false },
  });
  const roles = useWatch({ control, name: "roles" });
  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await api("/admin/users", { json: { ...v, designation: v.designation || null } });
      reset();
      onDone();
    } catch (e) {
      setError(e);
    }
  });
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Add an official" description="Creates a local account. Share the initial password through an official channel; production sign-in will use Parichay SSO."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="nu-form" busy={isSubmitting}>Create account</Button></>}>
      <form id="nu-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field id="nu-name" label="Full name" required error={errors.full_name?.message}><input {...register("full_name")} {...fieldA11y("nu-name", errors.full_name?.message)} className={inputCls} /></Field>
        <Field id="nu-email" label="Official e-mail" required error={errors.email?.message}><input {...register("email")} {...fieldA11y("nu-email", errors.email?.message)} type="email" className={inputCls} /></Field>
        <Field id="nu-desig" label="Designation"><input {...register("designation")} id="nu-desig" className={inputCls} /></Field>
        <Field id="nu-unit" label="Unit" required error={errors.unit?.message}>
          <select {...register("unit")} {...fieldA11y("nu-unit", errors.unit?.message)} className={inputCls}>
            <option value="">Choose a unit</option>{meta?.units.map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2"><RolePicker value={roles} onChange={(v) => setValue("roles", v, { shouldValidate: true })} />{errors.roles && <p className="mt-1 text-xs text-danger">{errors.roles.message}</p>}</div>
        <Field id="nu-pw" label="Initial password" required error={errors.password?.message} hint="At least 12 characters."><input {...register("password")} {...fieldA11y("nu-pw", errors.password?.message, true)} type="password" autoComplete="new-password" className={inputCls} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" {...register("sealed_clearance")} className="h-4 w-4 accent-[var(--action)]" />Cleared for sealed categories</label>
        <div className="sm:col-span-2"><ErrorNote error={error} /></div>
      </form>
    </Modal>
  );
}

export default function AdminUsers() {
  const toast = useToast();
  const { data, error, mutate } = useApi<{ items: User[] }>("/admin/users");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [toggle, setToggle] = useState<User | null>(null);
  const [opError, setOpError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const patch = async (u: User, body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    setOpError(null);
    try {
      await api(`/admin/users/${u.id}`, { method: "PATCH", json: body });
      toast({ kind: "success", title: msg });
      setEditing(null);
      setToggle(null);
      void mutate();
    } catch (e) {
      setOpError(e);
    } finally {
      setBusy(false);
    }
  };
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{data ? `${data.items.length} accounts` : "Loading…"}. Disabling an account revokes its active sessions.</p>
        <Button onClick={() => setCreating(true)} icon={<UserPlus size={15} aria-hidden />}>Add official</Button>
      </div>
      <ErrorNote error={opError} />
      {!data ? <TableSkeleton rows={8} /> : (
        <Table caption="User accounts" head={["Official", "Unit", "Roles", "Sealed", "Last sign-in", "Status", ""]}>
          {data.items.map((u) => (
            <tr key={u.id} className={cx(!u.is_active && "opacity-60")}>
              <td><p className="font-medium">{u.full_name}</p><p className="text-xs text-muted">{u.email}</p></td>
              <td className="font-semibold">{u.unit}</td>
              <td><span className="flex max-w-xs flex-wrap gap-1">{u.roles.map((r) => <Badge key={r}>{label(r)}</Badge>)}</span></td>
              <td>{u.sealed_clearance ? <Badge tone="warn">Cleared</Badge> : <span className="text-muted">—</span>}</td>
              <td className="whitespace-nowrap text-xs">{fmtDateTime(u.last_login_at)}</td>
              <td>{u.is_active ? <Badge tone="ok">Active</Badge> : <Badge>Disabled</Badge>}</td>
              <td className="whitespace-nowrap text-right">
                <Button size="sm" variant="ghost" onClick={() => { setEditing(u); setRoles(u.roles); }}>Edit roles</Button>
                <Button size="sm" variant="secondary" onClick={() => setToggle(u)}>{u.is_active ? "Disable" : "Enable"}</Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <CreateUser open={creating} onClose={() => setCreating(false)} onDone={() => { setCreating(false); toast({ kind: "success", title: "Account created." }); void mutate(); }} />
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Roles · ${editing?.full_name ?? ""}`} description="Takes effect at the official's next request."
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button busy={busy} disabled={roles.length === 0} onClick={() => editing && patch(editing, { roles }, "Roles updated.")}>Save roles</Button></>}>
        <RolePicker value={roles} onChange={setRoles} />
      </Modal>
      <Modal open={!!toggle} onClose={() => setToggle(null)} size="sm" title={toggle?.is_active ? `Disable ${toggle?.full_name}?` : `Enable ${toggle?.full_name}?`}
        description={toggle?.is_active ? "They are signed out everywhere and cannot sign in until re-enabled. Their cases stay with their unit." : "They can sign in again with their existing password."}
        footer={<><Button variant="ghost" onClick={() => setToggle(null)}>Cancel</Button><Button variant={toggle?.is_active ? "danger" : "primary"} busy={busy} onClick={() => toggle && patch(toggle, { is_active: !toggle.is_active }, toggle.is_active ? "Account disabled." : "Account enabled.")}>{toggle?.is_active ? "Disable account" : "Enable account"}</Button></>} />
    </div>
  );
}
