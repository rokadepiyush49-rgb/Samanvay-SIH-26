"use client";

import { BarChart3, Table2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Card, cx } from "./ui";

/**
 * Small, dependency-free charts for the cockpit and reports. Rules (see the dataviz guidance): thin marks, 2px gaps
 * between touching segments, a legend for 2+ series, text in ink tokens (never the series colour), a hover/focus
 * tooltip, and a table view of the same numbers. Series colours are CSS tokens validated for colour-blind separation.
 */

export type Series = { key: string; name: string; color: string };

export const STATUS_SERIES: Series[] = [
  { key: "pending", name: "Pending", color: "var(--series-1)" },
  { key: "under_process", name: "Under process", color: "var(--series-2)" },
  { key: "disposed", name: "Disposed", color: "var(--series-3)" },
  { key: "transferred", name: "Transfer in flight", color: "var(--series-4)" },
];

export function Legend({ items }: { items: Series[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
      {items.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />{s.name}</li>
      ))}
    </ul>
  );
}

export type TableData = { head: string[]; rows: (string | number)[][] };

/** Card with a chart / table toggle. The table carries every value, so nothing depends on reading the chart. */
export function ChartCard({ title, description, legend, table, children, footer }:
  { title: string; description?: ReactNode; legend?: Series[]; table: TableData; children: ReactNode; footer?: ReactNode }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <Card title={title} description={description}
      actions={
        <div role="group" aria-label={`${title}: view as`} className="inline-flex rounded-lg border border-rule p-0.5">
          {(["chart", "table"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={cx("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium", view === v ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}>
              {v === "chart" ? <BarChart3 size={13} aria-hidden /> : <Table2 size={13} aria-hidden />}{v === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      }>
      {view === "chart" ? (
        <div className="flex flex-col gap-3">
          {legend && legend.length > 1 && <Legend items={legend} />}
          {children}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead><tr className="border-b border-rule text-xs text-muted">{table.head.map((h) => <th key={h} scope="col" className="px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i} className="border-b border-rule last:border-0">{r.map((v, j) => <td key={j} className={cx("px-2 py-1.5", j > 0 && "tabular")}>{typeof v === "number" ? v.toLocaleString("en-IN") : v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {footer && <div className="mt-3 text-xs text-muted">{footer}</div>}
    </Card>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const compact = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K` : String(v));

/** Multi-series line chart over a category axis (months), with crosshair tooltip and arrow-key navigation. */
export function LineChart({ points, series, height = 240, label }: { points: { x: string; label: string; values: Record<string, number> }[]; series: Series[]; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const pad = { l: 40, r: 16, t: 12, b: 26 };
  const W = Math.max(width, 280);
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0))));
  const x = (i: number) => pad.l + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 64))));
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - r.left) / r.width) * W - pad.l;
    setActive(Math.max(0, Math.min(points.length - 1, Math.round((rel / iw) * (points.length - 1)))));
  };
  const a = active !== null ? points[active] : null;
  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={W} height={height} role="img" aria-label={label} tabIndex={0}
          onPointerMove={onMove} onPointerLeave={() => setActive(null)} onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setActive((i) => Math.min(points.length - 1, (i ?? -1) + 1));
            if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? points.length) - 1));
          }}
          className="block touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-action/40">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--series-grid)" />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{compact(Math.round(t))}</text>
            </g>
          ))}
          {points.map((p, i) => i % every === 0 && <text key={p.x} x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{p.label}</text>)}
          {series.map((s) => (
            <polyline key={s.key} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
              points={points.map((p, i) => `${x(i)},${y(p.values[s.key] ?? 0)}`).join(" ")} />
          ))}
          {series.map((s) => {
            const last = points.length - 1;
            return last >= 0 && <circle key={s.key} cx={x(last)} cy={y(points[last].values[s.key] ?? 0)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />;
          })}
          {a && active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={pad.t} y2={pad.t + ih} stroke="var(--rule-strong)" />
              {series.map((s) => <circle key={s.key} cx={x(active)} cy={y(a.values[s.key] ?? 0)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />)}
            </g>
          )}
        </svg>
      )}
      {a && active !== null && (
        <div role="status" className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border border-rule bg-surface px-3 py-2 text-xs shadow-pop"
          style={{ left: Math.min(Math.max(0, x(active) + 12), W - 160) }}>
          <p className="mb-1 font-semibold">{a.label}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />{s.name}</span>
              <b className="tabular">{(a.values[s.key] ?? 0).toLocaleString("en-IN")}</b>
            </p>
          ))}
          {a.values.on_time !== undefined && a.values.disposed > 0 && <p className="mt-1 border-t border-rule pt-1 text-muted">Within timeline: <b className="text-ink tabular">{Math.round((100 * a.values.on_time) / a.values.disposed)}%</b></p>}
        </div>
      )}
    </div>
  );
}

export type BarRow = { key: string; label: string; sub?: string; href?: string; segments: Record<string, number>; note?: string };

/** Horizontal bars, single or stacked. Each row can drill down to the underlying records. */
export function BarChart({ rows, series, format = (v) => v.toLocaleString("en-IN"), max: fixedMax, label }:
  { rows: BarRow[]; series: Series[]; format?: (v: number) => string; max?: number; label: string }) {
  const totals = rows.map((r) => series.reduce((a, s) => a + (r.segments[s.key] ?? 0), 0));
  const max = fixedMax ?? Math.max(1, ...totals);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <ul className="flex flex-col gap-2.5" aria-label={label}>
      {rows.map((r, i) => {
        const total = totals[i];
        const tip = series.map((s) => `${s.name} ${format(r.segments[s.key] ?? 0)}`).join(", ");
        const body = (
          <>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{r.label}</span>
              {r.sub && <span className="block truncate text-[11px] text-muted">{r.sub}</span>}
            </span>
            <span className="relative flex h-5 items-stretch gap-[2px]" aria-hidden>
              {series.map((s, j) => {
                const v = r.segments[s.key] ?? 0;
                if (!v) return null;
                const isLast = series.slice(j + 1).every((n) => !(r.segments[n.key] ?? 0));
                return <span key={s.key} className={cx("block", isLast && "rounded-r-[4px]")} style={{ width: `${(v / max) * 100}%`, background: s.color, minWidth: 2 }} />;
              })}
            </span>
            <span className="text-right text-sm font-semibold tabular">{format(total)}{r.note && <span className="block text-[11px] font-normal text-muted">{r.note}</span>}</span>
            {hover === r.key && series.length > 1 && (
              <span role="status" className="pointer-events-none absolute left-28 top-full z-10 mt-1 rounded-lg border border-rule bg-surface px-3 py-2 text-xs shadow-pop">
                <span className="mb-1 block font-semibold">{r.label}</span>
                {series.map((s) => (
                  <span key={s.key} className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.name}</span>
                    <b className="tabular">{format(r.segments[s.key] ?? 0)}</b>
                  </span>
                ))}
                {r.href && <span className="mt-1 block text-muted">Select to open the cases</span>}
              </span>
            )}
          </>
        );
        const cls = "relative grid grid-cols-[minmax(5.5rem,9rem)_minmax(0,1fr)_4.5rem] items-center gap-3 rounded-md px-1 py-0.5";
        return (
          <li key={r.key} onPointerEnter={() => setHover(r.key)} onPointerLeave={() => setHover(null)}>
            {r.href ? (
              <Link href={r.href} className={cx(cls, "hover:bg-surface-2/70")} aria-label={`${r.label}: ${tip}. Open the cases`} onFocus={() => setHover(r.key)} onBlur={() => setHover(null)}>{body}</Link>
            ) : <div className={cls} aria-label={`${r.label}: ${tip}`}>{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** Vertical columns for a single series (e.g. ageing buckets); one column may be emphasised. */
export function ColumnChart({ bars, label, height = 180 }: { bars: { key: string; label: string; value: number; href?: string; emphasis?: boolean }[]; label: string; height?: number }) {
  const max = niceMax(Math.max(1, ...bars.map((b) => b.value)));
  return (
    <div className="flex items-end gap-3" style={{ height }} role="list" aria-label={label}>
      {bars.map((b) => {
        const h = Math.max(2, Math.round((b.value / max) * (height - 44)));
        const inner = (
          <>
            <span className="text-xs font-semibold tabular">{b.value.toLocaleString("en-IN")}</span>
            <span className="block w-full max-w-12 rounded-t-[4px]" style={{ height: h, background: b.emphasis ? "var(--series-1)" : "var(--series-2)" }} aria-hidden />
            <span className="text-xs text-muted">{b.label}</span>
          </>
        );
        const cls = "flex flex-1 flex-col items-center justify-end gap-1.5 rounded-md pb-0.5 pt-1";
        return b.href ? (
          <Link role="listitem" key={b.key} href={b.href} className={cx(cls, "hover:bg-surface-2/70")} aria-label={`${b.label}: ${b.value}`} title={`${b.label}: ${b.value.toLocaleString("en-IN")}`}>{inner}</Link>
        ) : <div role="listitem" key={b.key} className={cls} aria-label={`${b.label}: ${b.value}`}>{inner}</div>;
      })}
    </div>
  );
}
