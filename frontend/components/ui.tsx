"use client";

import Link from "next/link";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { IconAlert, IconArrow, IconX } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Tone = "mint" | "yellow" | "pink" | "sky" | "cream" | "navy" | "plain";

const TONE: Record<Tone, string> = {
  mint: "bg-mint text-mint-ink",
  yellow: "bg-yellow text-yellow-ink",
  pink: "bg-pink text-pink-ink",
  sky: "bg-sky text-sky-ink",
  cream: "bg-cream text-ink",
  navy: "bg-navy text-on-navy",
  plain: "bg-surface text-ink",
};

export function Card({ children, className, tone = "plain" }: { children: ReactNode; className?: string; tone?: Tone }) {
  // min-w-0 lets wide tables scroll inside the card instead of stretching grid columns past the viewport.
  return <section className={cx("min-w-0 rounded-3xl p-5 sm:p-6", TONE[tone], tone === "plain" && "border border-rule", className)}>{children}</section>;
}

export function Hero({ kicker, title, children, side }: { kicker?: string; title: ReactNode; children?: ReactNode; side?: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] bg-navy px-6 py-7 text-on-navy sm:px-9 sm:py-9">
      <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-navy-2 opacity-70" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          {kicker && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-sky">{kicker}</p>}
          <h1 className="text-3xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl">{title}</h1>
          {children && <div className="mt-4 text-sm leading-relaxed text-on-navy/90 sm:text-base">{children}</div>}
        </div>
        {side && <div className="relative shrink-0">{side}</div>}
      </div>
    </section>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "soft" | "ghost" | "danger" | "light"; arrow?: boolean; busy?: boolean };

export function Button({ variant = "primary", arrow, busy, className, children, disabled, ...rest }: BtnProps) {
  const styles = {
    primary: "bg-navy text-white hover:bg-navy-2",
    soft: "bg-surface-2 text-ink border border-rule hover:bg-rule/60",
    ghost: "text-ink hover:bg-surface-2",
    danger: "bg-danger text-white hover:opacity-90",
    light: "bg-pink text-[#2b1430] hover:brightness-95",
  }[variant];
  return (
    <span className="inline-flex items-center gap-1">
      <button {...rest} disabled={disabled || busy}
        className={cx("inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50", styles, className)}>
        {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
        {children}
      </button>
      {arrow && (
        <span aria-hidden className={cx("grid h-10 w-10 place-items-center rounded-full", styles)}>
          <IconArrow size={18} />
        </span>
      )}
    </span>
  );
}

export function PillLink({ href, children, tone = "light" }: { href: string; children: ReactNode; tone?: "light" | "dark" }) {
  const s = tone === "light" ? "bg-pink text-[#2b1430]" : "bg-navy text-white";
  return (
    <Link href={href} className="group inline-flex items-center gap-1 text-sm font-semibold">
      <span className={cx("inline-flex min-h-10 items-center rounded-full px-5", s)}>{children}</span>
      <span className={cx("grid h-10 w-10 place-items-center rounded-full transition group-hover:translate-x-0.5", s)}><IconArrow size={18} /></span>
    </Link>
  );
}

export function Tile({ tone, title, value, hint, href, art }: { tone: Tone; title: string; value: ReactNode; hint?: string; href?: string; art?: ReactNode }) {
  const body = (
    <div className={cx("relative flex h-full min-h-40 flex-col justify-between overflow-hidden rounded-3xl p-5", TONE[tone])}>
      <div className="relative z-10">
        <p className="text-sm font-bold leading-tight">{title}</p>
        <p className="mt-1 text-4xl font-extrabold tracking-tight tabular">{value}</p>
        {hint && <p className="mt-1 text-xs opacity-80">{hint}</p>}
      </div>
      {art && <div className="pointer-events-none absolute -bottom-2 right-1 opacity-60">{art}</div>}
      {href && (
        <span className="relative z-10 mt-3 grid h-8 w-8 place-items-center rounded-full bg-navy text-white" aria-hidden>
          <IconArrow size={16} />
        </span>
      )}
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-3xl transition hover:-translate-y-0.5" aria-label={`${title}: open the cases`}>{body}</Link> : body;
}

/** Status chips use a shape and text, never colour alone. */
const STATUS_STYLE: Record<string, { tone: string; shape: string }> = {
  pending: { tone: "bg-yellow text-yellow-ink", shape: "○" },
  under_process: { tone: "bg-sky text-sky-ink", shape: "◐" },
  disposed: { tone: "bg-mint text-mint-ink", shape: "●" },
  rejected: { tone: "bg-surface-2 text-muted border border-rule", shape: "⊘" },
  transferred: { tone: "bg-pink text-pink-ink", shape: "⇄" },
};

export function StatusChip({ bucket, label }: { bucket: string; label: string }) {
  const s = STATUS_STYLE[bucket] ?? STATUS_STYLE.pending;
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", s.tone)}>
      <span aria-hidden>{s.shape}</span>
      {label}
    </span>
  );
}

const TYPE_STYLE: Record<string, string> = {
  P: "bg-pink text-pink-ink",
  D: "bg-yellow text-yellow-ink",
  R: "bg-sky text-sky-ink",
  C: "bg-mint text-mint-ink",
  L: "bg-surface-2 text-muted",
};
const TYPE_NAME: Record<string, string> = { P: "Parallel action", D: "Duplicate", R: "Related", C: "Co-occurrence", L: "Logged" };

export function TypeBadge({ type, prob }: { type: string; prob?: number }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold", TYPE_STYLE[type] ?? TYPE_STYLE.L)}>
      <span className="font-mono">{type}</span> {TYPE_NAME[type] ?? type}
      {/* Rule-triggered links (e.g. parallel action) carry no meaningful same-matter probability. */}
      {prob !== undefined && prob >= 0.01 && <span className="tabular opacity-80">· {prob.toFixed(2)}</span>}
    </span>
  );
}

export function Badge({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" | "danger" | "ok" | "info" }) {
  const s = {
    plain: "bg-surface-2 text-muted border border-rule",
    warn: "bg-yellow text-yellow-ink",
    danger: "bg-danger-soft text-danger",
    ok: "bg-mint text-mint-ink",
    info: "bg-sky text-sky-ink",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", s)}>{children}</span>;
}

export function Field({ label, hint, children, required }: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-semibold">{label}{required && <span className="text-danger"> *</span>}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-2xl border border-rule bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-[var(--focus)] focus:outline-none";

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-rule bg-surface px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  const fields = (e?.body?.errors as { field: string; message: string }[] | undefined) ?? [];
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
      <IconAlert size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{e?.title ?? "Something went wrong"}</p>
        <p>{e?.detail ?? (error instanceof Error ? error.message : "Please try again.")}</p>
        {fields.length > 0 && (
          <ul className="mt-1 list-disc pl-5">{fields.map((f) => <li key={f.field + f.message}>{f.field}: {f.message}</li>)}</ul>
        )}
      </div>
      {onRetry && <button onClick={onRetry} className="font-semibold underline">Retry</button>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}
      className={cx("m-auto w-[calc(100%-2rem)] rounded-3xl border border-rule bg-surface p-0 text-ink shadow-2xl backdrop:bg-[#0b0d24]/60", wide ? "max-w-3xl" : "max-w-xl")}>
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} className="rounded-full p-1 text-muted hover:bg-surface-2" aria-label="Close"><IconX size={18} /></button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 rounded-full bg-surface-2 p-1">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
          className={cx("rounded-full px-4 py-1.5 text-sm font-semibold transition", value === it.value ? "bg-navy text-white" : "text-muted hover:text-ink")}>
          {it.label}{it.count !== undefined && <span className="ml-1.5 tabular opacity-80">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Bar({ value, max, tone = "sky" }: { value: number; max: number; tone?: "sky" | "mint" | "pink" | "yellow" | "navy" }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  const bg = { sky: "bg-sky", mint: "bg-mint", pink: "bg-pink", yellow: "bg-yellow", navy: "bg-navy" }[tone];
  return <div className="h-2.5 w-full rounded-full bg-surface-2"><div className={cx("h-2.5 rounded-full", bg)} style={{ width: `${w}%` }} /></div>;
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-3xl border border-rule bg-surface">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead><tr className="border-b border-rule text-xs uppercase tracking-wide text-muted">{head.map((h, i) => <th key={i} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-rule [&>tr:last-child]:border-0 [&_td]:px-4 [&_td]:py-3 [&_td]:align-top">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function PageHead({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {children && <p className="mt-1 max-w-3xl text-sm text-muted">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
