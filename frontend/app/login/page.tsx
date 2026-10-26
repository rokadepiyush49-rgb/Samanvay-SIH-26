"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Eye, EyeOff, Info, KeyRound, LogIn, ShieldCheck, Users } from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { BrandStripe } from "@/components/shell/brand";
import { Button, ErrorNote, Field, cx, fieldA11y, inputCls } from "@/components/ui";
import { ApiError, api, clearPrivateCache, ensureCsrf } from "@/lib/api";
import { loginSchema, type LoginForm } from "@/lib/schemas";
import { applyPrefs, readPrefs } from "@/lib/session";
import type { DemoUser, Me } from "@/lib/types";


function safeNext(next: string | null): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : null;
}

function Notice({ tone, children }: { tone: "info" | "warn" | "ok"; children: React.ReactNode }) {
  return (
    <p role="status" className={cx("flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm",
      tone === "warn" ? "bg-warn-soft text-warn-ink" : tone === "ok" ? "bg-ok-soft text-ok-ink" : "bg-action-soft text-action-ink")}>
      <Info size={16} className="mt-0.5 shrink-0" aria-hidden />{children}
    </p>
  );
}

function DemoAccounts({ users, busy, onPick, defaultOpen }: { users: DemoUser[]; busy: string | null; onPick: (u: DemoUser) => void; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const groups = useMemo(() => users.reduce<Record<string, DemoUser[]>>((acc, u) => ((acc[u.unit_code] ??= []).push(u), acc), {}), [users]);
  return (
    <section className="rounded-xl border border-dashed border-warn/50 bg-surface" aria-labelledby="demo-h">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="demo-list"
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left">
        <span className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-warn-soft text-warn" aria-hidden><Users size={16} /></span>
          <span>
            <span id="demo-h" className="block text-sm font-semibold">Demo accounts <span className="ml-1 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warn-ink">Demo only</span></span>
            <span className="block text-xs text-muted">Synthetic officials for each role. Disabled when the server runs in production mode.</span>
          </span>
        </span>
        <ChevronDown size={18} className={cx("shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id="demo-list" className="flex max-h-[26rem] flex-col gap-4 overflow-y-auto border-t border-rule px-5 py-4">
          {Object.entries(groups).map(([unit, list]) => (
            <div key={unit}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{unit} · {list[0].unit_name}</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {list.map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => onPick(u)} disabled={!!busy} data-testid={`demo-${u.full_name}`}
                      className="flex w-full flex-col rounded-lg border border-rule px-3 py-2 text-left transition-colors hover:border-action hover:bg-action-soft/40 disabled:opacity-60">
                      <span className="text-sm font-medium">{u.full_name}{busy === u.id ? " — signing in…" : ""}</span>
                      <span className="truncate text-xs text-muted">{u.role_labels.join(" · ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const reason = params.get("reason");
  const switching = params.get("switch") === "1";
  const [show, setShow] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoUser[] | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({ resolver: zodResolver(loginSchema), mode: "onTouched" });

  useEffect(() => {
    applyPrefs(readPrefs());
    void ensureCsrf();
    api<DemoUser[]>("/auth/demo-users").then(setDemo).catch(() => setDemo(null));
  }, []);

  const done = (me: Me) => {
    clearPrivateCache();
    router.replace(next ?? me.landing);
  };

  const submit = handleSubmit(async (values) => {
    setBusy("form");
    setError(null);
    try {
      done(await api<Me>("/auth/login", { json: values }));
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  });

  const asDemo = async (u: DemoUser) => {
    setBusy(u.id);
    setError(null);
    try {
      if (switching) await api("/auth/logout", { method: "POST" }).catch(() => undefined);
      done(await api<Me>("/auth/demo-login", { json: { user_id: u.id } }));
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  };

  const locked = error instanceof ApiError && error.status === 423;
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <BrandStripe className="h-1.5" />
      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-4 py-10 lg:grid-cols-[1fr_minmax(0,30rem)] lg:gap-14">
        <section className="hidden flex-col items-center text-center lg:flex" aria-label="About Samanvay">
          <Image src="/brand/samanvay-logo.webp" alt="Samanvay — AICTE complaint monitoring and coordination" width={420} height={434} priority className="h-auto w-[min(100%,26rem)]" />
          <ul className="mt-8 grid w-full max-w-lg grid-cols-3 gap-3 text-left text-xs">
            {[
              ["One ledger", "Every case has one custodian unit and officer."],
              ["Explainable overlap", "Each link between cases shows its reasons."],
              ["Coordinated action", "Units agree before anyone acts."],
            ].map(([title, sub], i) => (
              <li key={title} className="rounded-lg border border-rule bg-surface p-3 shadow-card">
                <span className="mb-2 block h-1 w-8 rounded-full" style={{ background: ["var(--brand-blue)", "var(--brand-orange)", "var(--brand-green)"][i] }} aria-hidden />
                <p className="font-semibold text-ink">{title}</p>
                <p className="mt-0.5 text-muted">{sub}</p>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-col gap-5">
          <div className="flex justify-center lg:hidden">
            <Image src="/brand/samanvay-mark.png" alt="" width={72} height={72} priority />
          </div>
          <section className="rounded-xl border border-rule bg-surface p-6 shadow-card sm:p-8" aria-labelledby="signin-h">
            <p className="font-[family-name:var(--font-display)] text-xs font-semibold uppercase tracking-[0.14em] text-muted">AICTE · Samanvay <span lang="hi">समन्वय</span></p>
            <h1 id="signin-h" className="mt-1 text-2xl font-bold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-muted">For authorised AICTE officials. Use your official e-mail address.</p>

            <div className="mt-5 flex flex-col gap-3">
              {reason === "expired" && <Notice tone="warn">Your session expired or was signed out elsewhere. Sign in again to continue where you left off.</Notice>}
              {params.get("signed_out") === "1" && <Notice tone="ok">You have signed out. Cached case data was cleared from this browser tab.</Notice>}
              {switching && <Notice tone="info">Pick a demo official below to switch role.</Notice>}
            </div>

            <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-4" aria-describedby={error ? "signin-error" : undefined}>
              <Field id="email" label="Official e-mail" error={errors.email?.message} required>
                <input {...register("email")} {...fieldA11y("email", errors.email?.message)} className={inputCls} type="email" autoComplete="username" inputMode="email" placeholder="name@aicte-india.org" />
              </Field>
              <Field id="password" label="Password" error={errors.password?.message} required>
                <div className="relative">
                  <input {...register("password")} {...fieldA11y("password", errors.password?.message)} className={cx(inputCls, "pr-11")} type={show ? "text" : "password"} autoComplete="current-password" />
                  <button type="button" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? "Hide password" : "Show password"}
                    className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink">
                    {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  </button>
                </div>
              </Field>
              <div id="signin-error"><ErrorNote error={error} /></div>
              {locked && <p className="text-xs text-muted">Accounts lock for a short period after five failed attempts. Your administrator can unlock it sooner.</p>}
              <Button type="submit" busy={busy === "form"} icon={<LogIn size={16} aria-hidden />} className="w-full">{busy === "form" ? "Signing in…" : "Sign in"}</Button>
            </form>

            <div className="mt-5 grid gap-2 border-t border-rule pt-4 text-xs text-muted">
              <p className="flex items-start gap-2"><KeyRound size={14} className="mt-0.5 shrink-0" aria-hidden />Forgot your password? Self-service reset is not enabled. Ask your unit&apos;s system administrator to reset it.</p>
              <p className="flex items-start gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />Parichay single sign-on is planned for production and is not configured in this build.</p>
            </div>
          </section>

          {demo && demo.length > 0 && <DemoAccounts users={demo} busy={busy} onPick={asDemo} defaultOpen />}
          <p className="text-center text-xs text-muted">Samanvay · All records in this environment are synthetic.</p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
