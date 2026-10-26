"use client";

import { Accessibility, Languages, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Modal, PageHeader, cx } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { fmtDateTime, initials } from "@/lib/format";
import { useSession, type TextSize } from "@/lib/session";

function Choice<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-rule-strong p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cx("rounded-md px-3 py-1.5 text-[13px] font-medium", value === v ? "bg-navy text-white" : "text-muted hover:text-ink")}>{l}</button>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const { me, prefs, setPrefs, t, signOut, hasUnsaved } = useSession();
  const [session, setSession] = useState<{ expires_at: string } | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const extend = async () => {
    try {
      setSession(await api<{ expires_at: string }>("/auth/refresh", { method: "POST" }));
      setSessionError(null);
    } catch (e) {
      setSessionError(e instanceof ApiError ? e.detail || e.title : "Could not reach the server.");
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("nav.settings")} crumbs={[{ label: t("group.system") }, { label: t("nav.settings") }]} description="Your identity in Samanvay, display preferences for this browser, and your session." />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><UserRound size={16} aria-hidden />Identity</span>} description="Managed by your administrator. Contact them to change your unit or roles.">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-navy text-base font-bold text-white" aria-hidden>{initials(me.full_name)}</span>
            <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">Name</dt><dd className="font-medium">{me.full_name}</dd>
              <dt className="text-muted">Designation</dt><dd>{me.designation ?? "—"}</dd>
              <dt className="text-muted">E-mail</dt><dd className="truncate">{me.email}</dd>
              <dt className="text-muted">Unit</dt><dd><b>{me.unit.code}</b> · {me.unit.name}</dd>
              <dt className="text-muted">Roles</dt><dd className="flex flex-wrap gap-1">{me.role_labels.map((r) => <Badge key={r}>{r}</Badge>)}</dd>
              <dt className="text-muted">Sealed categories</dt><dd>{me.sealed_clearance ? <Badge tone="warn" icon={<ShieldCheck size={12} aria-hidden />}>Cleared</Badge> : "Not cleared"}</dd>
            </dl>
          </div>
        </Card>
        <Card title={<span className="flex items-center gap-2"><Languages size={16} aria-hidden />Language</span>} description="Menus, headings and common actions. Complaint text is always shown as received.">
          <Choice label="Interface language" value={prefs.lang} onChange={(lang) => setPrefs({ lang })} options={[["en", "English"], ["hi", "हिन्दी"]]} />
        </Card>
        <Card title={<span className="flex items-center gap-2"><Accessibility size={16} aria-hidden />Accessibility</span>} description="Saved in this browser only.">
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-medium">Text size</p><p className="text-xs text-muted">Scales the whole interface; layouts reflow.</p></div>
              <Choice<TextSize> label="Text size" value={prefs.textSize} onChange={(textSize) => setPrefs({ textSize })} options={[["default", "Default"], ["large", "Large"], ["larger", "Larger"]]} />
            </div>
            <label className="flex items-start justify-between gap-3">
              <span><span className="block font-medium">Reduce motion</span><span className="text-xs text-muted">Turns off transitions and animations. Your system setting is also respected.</span></span>
              <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--action)]" checked={prefs.reduceMotion} onChange={(e) => setPrefs({ reduceMotion: e.target.checked })} />
            </label>
          </div>
        </Card>
        <Card title={<span className="flex items-center gap-2"><ShieldCheck size={16} aria-hidden />Session</span>} description="Sessions are server-side, use an httpOnly cookie, and end after 30 minutes without activity.">
          <div className="flex flex-col gap-3 text-sm">
            <p>{session ? <>Session extended. It now expires at <b className="tabular">{fmtDateTime(session.expires_at)}</b> unless you keep working.</> : "This page keeps your session alive every 10 minutes while it is open."}</p>
            {sessionError && <p className="text-danger" role="alert">{sessionError}</p>}
            {me.demo_mode && <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn-ink">Demo build: one-click role switching is enabled. It is refused when the server runs in production mode.</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={extend}>Extend session now</Button>
              <Button variant="danger" icon={<LogOut size={15} aria-hidden />} onClick={() => (hasUnsaved() ? setConfirm(true) : void signOut({ force: true }))}>{t("action.signOut")}</Button>
            </div>
          </div>
        </Card>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} size="sm" title="Discard unsaved changes?" description="Signing out will discard changes that have not been saved."
        footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Keep editing</Button><Button variant="danger" onClick={() => void signOut({ force: true })}>Discard and sign out</Button></>} />
    </div>
  );
}
