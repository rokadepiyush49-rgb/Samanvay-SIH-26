"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Brand } from "@/components/shell";
import { Button, ErrorNote, Field, inputCls } from "@/components/ui";
import { api, ensureCsrf } from "@/lib/api";
import type { Me } from "@/lib/types";

type DemoUser = { id: string; full_name: string; designation: string | null; unit_code: string; unit_name: string; role_labels: string[] };

const UNIT_TONE: Record<string, string> = {
  PGRC: "bg-yellow text-yellow-ink", RB: "bg-mint text-mint-ink", "RO-W": "bg-sky text-sky-ink", "RO-S": "bg-sky text-sky-ink",
  "RO-N": "bg-sky text-sky-ink", ARC: "bg-pink text-pink-ink", AB: "bg-mint text-mint-ink", MS: "bg-pink text-pink-ink",
};

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoUser[] | null>(null);

  useEffect(() => {
    ensureCsrf();
    api<DemoUser[]>("/auth/demo-users").then(setDemo).catch(() => setDemo(null));
  }, []);

  const done = (me: Me) => router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : me.landing);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("form");
    setError(null);
    try {
      done(await api<Me>("/auth/login", { json: { email, password } }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  const asDemo = async (u: DemoUser) => {
    setBusy(u.id);
    setError(null);
    try {
      done(await api<Me>("/auth/demo-login", { json: { user_id: u.id } }));
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  };

  const groups = (demo ?? []).reduce<Record<string, DemoUser[]>>((acc, u) => {
    (acc[u.unit_code] ??= []).push(u);
    return acc;
  }, {});

  return (
    <div className="mx-auto grid min-h-screen max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1.05fr_1fr] lg:items-start lg:py-14">
      <section className="relative overflow-hidden rounded-[2rem] bg-navy p-8 text-on-navy sm:p-10">
        <div className="pointer-events-none absolute -bottom-24 -right-20 h-80 w-80 rounded-full bg-navy-2" />
        <p className="relative text-xs font-semibold uppercase tracking-[0.16em] text-sky">AICTE · SIH 2026 · PS SIH26264</p>
        <h1 className="relative mt-4 text-5xl font-extrabold leading-[0.95] tracking-tight text-white sm:text-7xl">Samanvay</h1>
        <p className="relative mt-2 text-xl font-semibold text-sky" lang="hi">समन्वय · coordination</p>
        <p className="relative mt-6 max-w-md text-base leading-relaxed">
          One case ledger for RB, PGRC, other bureaus and Regional Offices. Every case has one custodian, overlaps are
          explained, and units coordinate before anyone acts.
        </p>
        <div className="relative mt-8 grid grid-cols-2 gap-3 text-sm">
          {[
            ["bg-mint text-mint-ink", "Custody handshake", "No case lost between units"],
            ["bg-yellow text-yellow-ink", "Overlap engine", "Reasons on every link"],
            ["bg-pink text-pink-ink", "Conflict guard", "Coordinate before acting"],
            ["bg-sky text-sky-ink", "Audit chain", "Tamper-evident history"],
          ].map(([tone, title, sub]) => (
            <div key={title} className={`rounded-2xl p-4 ${tone}`}>
              <p className="font-bold">{title}</p>
              <p className="mt-0.5 text-xs opacity-80">{sub}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <div className="rounded-[2rem] border border-rule bg-surface p-6 sm:p-8">
          <Brand />
          <h2 className="mt-6 text-2xl font-extrabold">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Authorised AICTE officials only. Production uses Parichay single sign-on.</p>
          <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
            <Field label="Official e-mail"><input className={inputCls} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Password"><input className={inputCls} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <ErrorNote error={error} />
            <div><Button type="submit" busy={busy === "form"} arrow>Sign in</Button></div>
          </form>
        </div>

        {demo && demo.length > 0 && (
          <div className="rounded-[2rem] border border-rule bg-surface p-6 sm:p-8">
            <h2 className="text-lg font-extrabold">Demo: switch role</h2>
            <p className="mt-1 text-sm text-muted">Synthetic data. Pick an official to see their workspace. This shortcut is disabled in production builds.</p>
            <div className="mt-5 flex flex-col gap-4">
              {Object.entries(groups).map(([unit, users]) => (
                <div key={unit}>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{users[0].unit_name}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {users.map((u) => (
                      <button key={u.id} onClick={() => asDemo(u)} disabled={!!busy}
                        className={`rounded-2xl px-4 py-3 text-left transition hover:-translate-y-0.5 disabled:opacity-60 ${UNIT_TONE[unit] ?? "bg-surface-2 text-ink"}`}>
                        <span className="block text-sm font-bold">{u.full_name}{busy === u.id ? " …" : ""}</span>
                        <span className="block text-xs opacity-80">{u.designation}</span>
                        <span className="mt-1 block text-[11px] font-semibold uppercase tracking-wide opacity-80">{u.role_labels.join(" · ")}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
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
