"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, Lock, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { Dialog } from "radix-ui";
import React, {
  useId, useRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode,
} from "react";
import { errorMessage, type ApiError } from "@/lib/api";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "navy" | "coord";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-action text-white hover:bg-action-hover shadow-card",
  secondary: "bg-surface text-ink border border-rule-strong hover:bg-surface-2 shadow-card",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90 shadow-card",
  navy: "bg-navy text-white hover:bg-navy-2 shadow-card",
  coord: "bg-coord text-white hover:opacity-90 shadow-card",
};
const SIZE: Record<Size, string> = { sm: "h-8 px-3 text-[13px] gap-1.5", md: "h-10 px-4 text-sm gap-2" };

export function buttonCls(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cx(
    "inline-flex shrink-0 items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    VARIANT[variant], SIZE[size], className,
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; busy?: boolean; icon?: ReactNode };

export function Button({ variant = "primary", size = "md", busy, icon, className, children, disabled, type = "button", ...rest }: BtnProps) {
  return (
    <button type={type} {...rest} disabled={disabled || busy} aria-busy={busy || undefined} className={buttonCls(variant, size, className)}>
      {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = "secondary", size = "md", icon, className, children, ...rest }:
  AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: Variant; size?: Size; icon?: ReactNode }) {
  return <Link href={href} className={buttonCls(variant, size, className)} {...rest}>{icon}{children}</Link>;
}

/* ── Layout ──────────────────────────────────────────────────────────────── */

export function Card({ children, className, title, description, actions, padded = true, as: Tag = "section" }:
  { children?: ReactNode; className?: string; title?: ReactNode; description?: ReactNode; actions?: ReactNode; padded?: boolean; as?: "section" | "div" | "article" }) {
  // min-w-0 lets wide tables scroll inside the card instead of stretching grid columns past the viewport.
  return (
    <Tag className={cx("min-w-0 rounded-xl border border-rule bg-surface shadow-card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold leading-6">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children !== undefined && <div className={cx(padded && "p-5")}>{children}</div>}
    </Tag>
  );
}

export type Crumb = { label: string; href?: string };

export function PageHeader({ title, description, actions, crumbs, meta }:
  { title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: Crumb[]; meta?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
            {crumbs.map((c, i) => (
              <li key={c.label + i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} aria-hidden />}
                {c.href ? <Link href={c.href} className="hover:text-ink hover:underline">{c.label}</Link> : <span aria-current="page" className="font-medium text-ink">{c.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[1.5rem] font-bold leading-tight tracking-tight">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/* ── Badges ──────────────────────────────────────────────────────────────── */

export type Tone = "neutral" | "info" | "warn" | "danger" | "ok" | "coord" | "navy";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-rule",
  info: "bg-action-soft text-action-ink border-transparent",
  warn: "bg-warn-soft text-warn-ink border-transparent",
  danger: "bg-danger-soft text-danger-ink border-transparent",
  ok: "bg-ok-soft text-ok-ink border-transparent",
  coord: "bg-coord-soft text-coord-ink border-transparent",
  navy: "bg-navy text-white border-transparent",
};

export function Badge({ children, tone = "neutral", icon, className, title }: { children: ReactNode; tone?: Tone; icon?: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium leading-5", TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

/* ── Forms ───────────────────────────────────────────────────────────────── */

export const inputCls =
  "w-full rounded-lg border border-rule-strong bg-surface px-3 py-2 text-sm text-ink shadow-card placeholder:text-muted/70 focus:border-action focus:outline-none focus:ring-2 focus:ring-action/20 aria-[invalid=true]:border-danger disabled:bg-surface-2 disabled:text-muted";

/** Props that wire an input to its label, hint and error message. */
export function fieldA11y(id: string, error?: string, hint?: boolean) {
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined;
  return { id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy } as const;
}

export function Field({ id, label, hint, error, required, children, className }:
  { id?: string; label: ReactNode; hint?: ReactNode; error?: string; required?: boolean; children: ReactNode; className?: string }) {
  if (!id) {
    // Wrapping label: the control inside is associated implicitly (used where no error message is wired).
    return (
      <label className={cx("flex flex-col gap-1.5 text-sm", className)}>
        <span className="font-medium">{label}{required && <span className="text-danger" aria-hidden> *</span>}</span>
        {children}
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </label>
    );
  }
  return (
    <div className={cx("flex flex-col gap-1.5 text-sm", className)}>
      <label htmlFor={id} className="font-medium">
        {label}
        {required && <span className="text-danger" aria-hidden> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} className="flex items-center gap-1 text-xs font-medium text-danger"><AlertTriangle size={12} aria-hidden />{error}</p>}
    </div>
  );
}

/* ── States ──────────────────────────────────────────────────────────────── */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-md", className)} aria-hidden />;
}

export function PageSkeleton({ rows = 6, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="flex flex-col gap-5" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <div className="flex flex-col gap-2 rounded-xl border border-rule bg-surface p-4">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-rule bg-surface p-4" role="status">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-10" />)}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-sm text-muted" role="status">
      <Loader2 size={16} className="animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, children, icon, action, compact }: { title: string; children?: ReactNode; icon?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx("flex flex-col items-center rounded-xl border border-dashed border-rule-strong bg-surface text-center", compact ? "px-4 py-6" : "px-6 py-12")}>
      <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden>{icon ?? <Inbox size={20} />}</span>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Inline error banner for a failed request; shows field errors from RFC 9457 bodies. */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const { title, detail } = errorMessage(error);
  const fields = ((error as ApiError)?.body?.errors as { field: string; message: string }[] | undefined) ?? [];
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p>{detail}</p>
        {fields.length > 0 && <ul className="mt-1 list-disc pl-5">{fields.map((f) => <li key={f.field + f.message}>{f.field}: {f.message}</li>)}</ul>}
      </div>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry} icon={<RefreshCw size={14} aria-hidden />}>Retry</Button>}
    </div>
  );
}

/** Full-panel error for a page whose data failed to load. 403s render as a permission-denied state. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = (error as ApiError)?.status;
  if (status === 403) return <PermissionDenied detail={errorMessage(error).detail} />;
  const { title, detail } = errorMessage(error);
  return (
    <div role="alert" className="flex flex-col items-center rounded-xl border border-rule bg-surface px-6 py-12 text-center">
      <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-danger-soft text-danger" aria-hidden><AlertTriangle size={20} /></span>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted">{detail}</p>
      {onRetry && <Button className="mt-4" variant="secondary" onClick={onRetry} icon={<RefreshCw size={14} aria-hidden />}>Try again</Button>}
    </div>
  );
}

export function PermissionDenied({ detail }: { detail?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-xl border border-rule bg-surface px-6 py-12 text-center" data-testid="permission-denied">
      <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-warn-soft text-warn-ink" aria-hidden><Lock size={20} /></span>
      <p className="font-semibold">You do not have access to this page</p>
      <p className="mt-1 max-w-md text-sm text-muted">{detail ?? "Your role does not include this workspace. Ask your unit administrator if you need it."}</p>
      <ButtonLink href="/" className="mt-4">Go to my workspace</ButtonLink>
    </div>
  );
}

/* ── Dialogs ─────────────────────────────────────────────────────────────── */

export function Modal({ open, onClose, title, description, children, footer, size = "md" }:
  { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50" />
        <Dialog.Content
          className={cx("fixed left-1/2 top-1/2 z-50 flex max-h-[min(90vh,52rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-rule bg-surface text-ink shadow-pop focus:outline-none",
            { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" }[size])}
          {...(description ? {} : { "aria-describedby": undefined })}>
          <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-0.5 text-sm text-muted">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close"><X size={18} /></Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-rule bg-surface-2/60 px-5 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */

export type TabItem<T extends string> = { value: T; label: string; count?: number; icon?: ReactNode };

/** In-page tabs (WAI-ARIA tabs pattern with arrow-key navigation). Render panels with <TabPanel>. */
export function Tabs<T extends string>({ value, onChange, items, label, idBase }: { value: T; onChange: (v: T) => void; items: TabItem<T>[]; label: string; idBase?: string }) {
  const auto = useId();
  const base = idBase ?? auto;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = items.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next].value);
  };
  return (
    <div role="tablist" aria-label={label} className="-mb-px flex gap-1 overflow-x-auto border-b border-rule">
      {items.map((it, i) => {
        const active = value === it.value;
        return (
          <button key={it.value} ref={(el) => { refs.current[i] = el; }} role="tab" type="button" id={`${base}-tab-${it.value}`}
            aria-selected={active} aria-controls={`${base}-panel-${it.value}`} tabIndex={active ? 0 : -1}
            onClick={() => onChange(it.value)} onKeyDown={(e) => onKey(e, i)}
            className={cx("inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "border-action text-action-ink" : "border-transparent text-muted hover:border-rule-strong hover:text-ink")}>
            {it.icon}
            {it.label}
            {it.count !== undefined && <span className={cx("rounded-full px-1.5 text-[11px] tabular leading-5", active ? "bg-action-soft text-action-ink" : "bg-surface-2 text-muted")}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idBase, value, children, className }: { idBase: string; value: string; children: ReactNode; className?: string }) {
  return <div role="tabpanel" id={`${idBase}-panel-${value}`} aria-labelledby={`${idBase}-tab-${value}`} tabIndex={0} className={cx("focus:outline-none", className)}>{children}</div>;
}

/** Route-based sub-navigation (each tab is its own page). */
export function SubNav({ items, active, label }: { items: { href: string; label: string; icon?: ReactNode; match?: string }[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto border-b border-rule">
      {items.map((it) => {
        const on = (it.match ?? it.href) === active;
        return (
          <Link key={it.href} href={it.href} aria-current={on ? "page" : undefined}
            className={cx("inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              on ? "border-action text-action-ink" : "border-transparent text-muted hover:border-rule-strong hover:text-ink")}>
            {it.icon}{it.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ── Tables ──────────────────────────────────────────────────────────────── */

/**
 * Makes a whole table row open its record on click, while the primary link in the row stays the keyboard and
 * screen-reader target. Clicks on links, buttons or form controls inside the row keep their own behaviour.
 */
export function rowClick(go: () => void) {
  return (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return;
    if (window.getSelection()?.toString()) return;
    go();
  };
}

export function Table({ head, children, caption, minWidth = 720, className }: { head: ReactNode[]; children: ReactNode; caption?: string; minWidth?: number; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-xl border border-rule bg-surface shadow-card", className)}>
      <table className="w-full border-collapse text-left text-sm" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-surface-2/70">
          <tr className="border-b border-rule text-xs font-semibold text-muted">
            {head.map((h, i) => <th key={i} scope="col" className="whitespace-nowrap px-4 py-2.5 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-rule [&>tr:last-child]:border-0 [&_td]:px-4 [&_td]:py-3 [&_td]:align-top">{children}</tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPrev, onNext, hasNext, busy }:
  { page: number; pageSize: number; total: number; onPrev: () => void; onNext: () => void; hasNext: boolean; busy?: boolean }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted" aria-live="polite">Showing <b className="tabular text-ink">{from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")}</b> of <b className="tabular text-ink">{total.toLocaleString("en-IN")}</b></p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onPrev} disabled={page <= 1 || busy} icon={<ChevronLeft size={14} aria-hidden />}>Previous</Button>
        <span className="tabular text-xs text-muted">Page {page}</span>
        <Button size="sm" variant="secondary" onClick={onNext} disabled={!hasNext || busy}>Next<ChevronRight size={14} aria-hidden /></Button>
      </div>
    </nav>
  );
}

/* ── KPI ─────────────────────────────────────────────────────────────────── */

const KPI_ACCENT: Record<Tone, string> = {
  neutral: "text-muted bg-surface-2", info: "text-action bg-action-soft", warn: "text-warn bg-warn-soft", danger: "text-danger bg-danger-soft",
  ok: "text-ok bg-ok-soft", coord: "text-coord bg-coord-soft", navy: "text-white bg-navy",
};

export function KpiCard({ label, value, hint, icon, tone = "neutral", href, testId }:
  { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: Tone; href?: string; testId?: string }) {
  const body = (
    <div className="flex h-full items-start justify-between gap-3 rounded-xl border border-rule bg-surface p-4 shadow-card transition-colors group-hover:border-rule-strong" data-testid={testId}>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <p className="mt-1 text-[1.75rem] font-bold leading-none tracking-tight tabular">{value}</p>
        {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
      </div>
      {icon && <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-lg", KPI_ACCENT[tone])} aria-hidden>{icon}</span>}
    </div>
  );
  return href ? <Link href={href} className="group block h-full rounded-xl" aria-label={`${label}: ${typeof value === "string" || typeof value === "number" ? value : ""}. Open the matching cases`}>{body}</Link> : body;
}

export function DataNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted">{children}</p>;
}
