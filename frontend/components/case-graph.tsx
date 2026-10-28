"use client";

/**
 * Institutional Case Graph: one institution, the units holding its cases, the cases, and the overlap links between
 * them. Cross-unit links are what "Potential Overlapping Cases – Coordination Required" is about, so they are drawn
 * strongest. Layout is a small deterministic force simulation (no randomness), computed once per data set.
 */
import { Building2, ExternalLink, GitMerge, Network } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtDate } from "@/lib/format";
import type { CaseRow, Institution360 } from "@/lib/types";
import { OVERLAP_TYPE_NAME } from "./status";
import { Badge, EmptyState, cx } from "./ui";

type Link360 = NonNullable<Institution360["links"]>[number];
type Node = { id: string; kind: "inst" | "unit" | "case"; x: number; y: number; vx: number; vy: number; unit?: string; c?: CaseRow };
type Edge = { a: string; b: string; kind: "spoke" | "hub" | "link"; link?: Link360 };

const W = 900, H = 600;
const UNIT_COLORS = ["var(--series-2)", "var(--series-1)", "var(--series-3)", "var(--series-4)", "var(--navy)", "var(--muted)"];
const LINK_COLORS: Record<string, string> = { P: "var(--danger)", D: "var(--warn)", R: "var(--coord)", C: "var(--action)" };
const CLOSED = new Set(["disposed", "rejected"]);

function layout(cases: CaseRow[], links: Link360[], units: string[]) {
  const nodes: Node[] = [{ id: "inst", kind: "inst", x: W / 2, y: H / 2, vx: 0, vy: 0 }];
  const edges: Edge[] = [];
  units.forEach((u, i) => {
    const a = (2 * Math.PI * i) / units.length - Math.PI / 2;
    nodes.push({ id: `u:${u}`, kind: "unit", unit: u, x: W / 2 + Math.cos(a) * 170, y: H / 2 + Math.sin(a) * 150, vx: 0, vy: 0 });
    edges.push({ a: "inst", b: `u:${u}`, kind: "hub" });
  });
  const perUnit: Record<string, number> = {};
  cases.forEach((c) => {
    const u = c.holding_unit.code;
    const k = (perUnit[u] = (perUnit[u] ?? 0) + 1);
    const hub = nodes.find((n) => n.id === `u:${u}`)!;
    const a = k * 2.399; // golden angle: an even spread without randomness
    nodes.push({ id: c.case_no, kind: "case", unit: u, c, x: hub.x + Math.cos(a) * (28 + 6 * Math.sqrt(k)), y: hub.y + Math.sin(a) * (28 + 6 * Math.sqrt(k)), vx: 0, vy: 0 });
    edges.push({ a: `u:${u}`, b: c.case_no, kind: "spoke" });
  });
  const ids = new Set(cases.map((c) => c.case_no));
  links.forEach((l) => { if (ids.has(l.a) && ids.has(l.b)) edges.push({ a: l.a, b: l.b, kind: "link", link: l }); });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rest = { hub: 170, spoke: 46, link: 90 } as const;
  const pull = { hub: 0.02, spoke: 0.06, link: 0.03 } as const;
  for (let it = 0; it < 260; it++) {
    const cool = 1 - it / 260;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const p = nodes[i], q = nodes[j];
        let dx = q.x - p.x, dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = 0.1 * (j - i); dy = 0.1; d2 = dx * dx + dy * dy; }
        const f = (p.kind === "case" && q.kind === "case" ? 260 : 1400) / d2;
        const d = Math.sqrt(d2);
        p.vx -= (dx / d) * f; p.vy -= (dy / d) * f;
        q.vx += (dx / d) * f; q.vy += (dy / d) * f;
      }
    }
    for (const e of edges) {
      const p = byId.get(e.a)!, q = byId.get(e.b)!;
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - rest[e.kind]) * pull[e.kind];
      p.vx += (dx / d) * f; p.vy += (dy / d) * f;
      q.vx -= (dx / d) * f; q.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      if (n.kind === "inst") { n.x = W / 2; n.y = H / 2; n.vx = n.vy = 0; continue; }
      n.vx += (W / 2 - n.x) * 0.004; n.vy += (H / 2 - n.y) * 0.004;
      const step = Math.min(12, Math.hypot(n.vx, n.vy)) * cool;
      const v = Math.hypot(n.vx, n.vy) || 1;
      n.x = Math.max(24, Math.min(W - 24, n.x + (n.vx / v) * step));
      n.y = Math.max(24, Math.min(H - 24, n.y + (n.vy / v) * step));
      n.vx *= 0.5; n.vy *= 0.5;
    }
  }
  // Fit the settled layout to the canvas so small graphs are not lost in the middle.
  const pad = 48;
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min(3, (W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, y1 - y0));
  for (const n of nodes) {
    n.x = W / 2 + (n.x - (x0 + x1) / 2) * k;
    n.y = H / 2 + (n.y - (y0 + y1) / 2) * k;
  }
  return { nodes, edges, byId };
}

export function CaseGraph({ data }: { data: Institution360 }) {
  const [onlyLinked, setOnlyLinked] = useState(false);
  const [showClosed, setShowClosed] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const links = useMemo(() => data.links ?? [], [data.links]);

  const linked = useMemo(() => new Set(links.flatMap((l) => [l.a, l.b])), [links]);
  const cases = useMemo(
    () => data.cases.filter((c) => (showClosed || !CLOSED.has(c.bucket)) && (!onlyLinked || linked.has(c.case_no))),
    [data.cases, showClosed, onlyLinked, linked],
  );
  const units = useMemo(() => [...new Set(cases.map((c) => c.holding_unit.code))].sort(), [cases]);
  const color = (u?: string) => UNIT_COLORS[Math.max(0, units.indexOf(u ?? "")) % UNIT_COLORS.length];
  const { nodes, edges, byId } = useMemo(() => layout(cases, links, units), [cases, links, units]);

  const unitOf = new Map(data.cases.map((c) => [c.case_no, c.holding_unit.code]));
  const crossUnit = links.filter((l) => unitOf.get(l.a) && unitOf.get(l.b) && unitOf.get(l.a) !== unitOf.get(l.b));
  const focus = hover ?? selected;
  const near = useMemo(() => {
    if (!focus) return null;
    const s = new Set([focus]);
    edges.forEach((e) => { if (e.a === focus) s.add(e.b); if (e.b === focus) s.add(e.a); });
    return s;
  }, [focus, edges]);
  const sel = selected ? byId.get(selected) : null;
  const selLinks = selected ? links.filter((l) => l.a === selected || l.b === selected) : [];

  if (data.cases.length === 0) return <EmptyState title="No cases to draw." icon={<Network size={20} />} />;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <p className="text-muted"><b className="text-ink tabular">{cases.length}</b> cases · <b className="text-ink tabular">{units.length}</b> units · <b className={cx("tabular", crossUnit.length ? "text-coord" : "text-ink")}>{crossUnit.length}</b> cross-unit links · <b className="text-ink tabular">{data.clusters.length}</b> confirmed clusters</p>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} className="accent-[var(--action)]" />Only linked cases</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="accent-[var(--action)]" />Show closed</label>
        </div>
        <div className="overflow-x-auto rounded-xl border border-rule bg-surface">
          <svg viewBox={`0 0 ${W} ${H}`} className="block min-w-[640px]" role="img" aria-label={`Graph of ${cases.length} cases across ${units.length} units, ${links.length} links`}
            onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
            {edges.map((e, i) => {
              const p = byId.get(e.a)!, q = byId.get(e.b)!;
              const dim = near && !(near.has(e.a) && near.has(e.b));
              if (e.kind === "link") {
                const l = e.link!;
                const cross = unitOf.get(l.a) !== unitOf.get(l.b);
                return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={LINK_COLORS[l.type] ?? "var(--muted)"} strokeWidth={cross ? 2.6 : 1.6}
                  strokeDasharray={l.status === "CONFIRMED" ? undefined : "5 4"} opacity={dim ? 0.12 : 0.9} />;
              }
              return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="var(--rule-strong)" strokeWidth={e.kind === "hub" ? 1.4 : 1} opacity={dim ? 0.15 : e.kind === "hub" ? 0.8 : 0.55} />;
            })}
            {nodes.map((n) => {
              const dim = near && !near.has(n.id);
              if (n.kind === "inst") {
                return (
                  <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.35 : 1}>
                    <circle r={26} fill="var(--navy)" />
                    <foreignObject x={-10} y={-10} width={20} height={20}><Building2 size={20} color="var(--on-navy)" aria-hidden /></foreignObject>
                  </g>
                );
              }
              if (n.kind === "unit") {
                return (
                  <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.35 : 1}>
                    <rect x={-26} y={-13} width={52} height={26} rx={13} fill={color(n.unit)} />
                    <text textAnchor="middle" dy="4.5" fontSize="12" fontWeight="700" fill="#fff">{n.unit}</text>
                  </g>
                );
              }
              const c = n.c!;
              const closed = CLOSED.has(c.bucket);
              const on = selected === n.id;
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.2 : 1} className="cursor-pointer outline-none"
                  tabIndex={0} role="button" aria-label={`${c.case_no}, ${c.holding_unit.code}, ${c.status_label}`} aria-pressed={on}
                  onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}
                  onClick={() => setSelected(on ? null : n.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(on ? null : n.id); } }}>
                  <title>{`${c.case_no} · ${c.category.name} · ${c.status_label}`}</title>
                  {on && <circle r={13} fill="none" stroke="var(--ink)" strokeWidth={1.5} />}
                  {c.overlaps.parallel_open > 0 && <circle r={11} fill="none" stroke="var(--danger)" strokeWidth={1.4} strokeDasharray="2 2" />}
                  <circle r={closed ? 5 : 7} fill={closed ? color(n.unit) : "var(--surface)"} stroke={color(n.unit)} strokeWidth={closed ? 0 : 2.6} opacity={closed ? 0.55 : 1} />
                  {(hover === n.id || on) && (
                    <text y={-14} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink)" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke" className="font-mono">{c.case_no}</text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Legend">
          <li className="flex items-center gap-1.5"><svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="5" fill="none" stroke="var(--series-2)" strokeWidth="2.4" /></svg>Open case (colour = holding unit)</li>
          <li className="flex items-center gap-1.5"><svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="4.5" fill="var(--series-2)" opacity="0.55" /></svg>Closed case</li>
          {(["P", "D", "R", "C"] as const).map((t) => (
            <li key={t} className="flex items-center gap-1.5"><svg width="22" height="8" aria-hidden><line x1="1" x2="21" y1="4" y2="4" stroke={LINK_COLORS[t]} strokeWidth="2.4" /></svg>{OVERLAP_TYPE_NAME[t]}</li>
          ))}
          <li className="flex items-center gap-1.5"><svg width="22" height="8" aria-hidden><line x1="1" x2="21" y1="4" y2="4" stroke="var(--muted)" strokeWidth="2" strokeDasharray="5 4" /></svg>Proposed (dashed) · confirmed (solid) · thicker = across units</li>
        </ul>
      </div>
      <aside className="flex flex-col gap-3">
        {sel?.c ? (
          <div className="rounded-xl border border-rule bg-surface p-4 shadow-card" data-testid="graph-selection">
            <p className="flex items-center justify-between gap-2"><span className="font-mono text-sm font-semibold">{sel.c.case_no}</span><Badge>{sel.c.holding_unit.code}</Badge></p>
            <p className="mt-1 text-sm">{sel.c.category.name}</p>
            <p className="mt-1 text-xs text-muted">{sel.c.status_label} · received {fmtDate(sel.c.received_on)}{sel.c.holding_officer ? ` · ${sel.c.holding_officer.name}` : ""}</p>
            {selLinks.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1.5 border-t border-rule pt-3 text-xs">
                {selLinks.map((l) => {
                  const other = l.a === sel.id ? l.b : l.a;
                  return (
                    <li key={other} className="flex flex-col">
                      <button type="button" className="self-start font-mono font-semibold text-action-ink hover:underline" onClick={() => setSelected(other)}>{other}</button>
                      <span className="text-muted">{unitOf.get(other)} · {OVERLAP_TYPE_NAME[l.type] ?? l.type} · {l.status.toLowerCase()}</span>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mt-3 border-t border-rule pt-3 text-xs text-muted">No overlap links.</p>}
            <Link href={`/cases/${sel.c.case_no}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-action-ink hover:underline">Open case <ExternalLink size={13} aria-hidden /></Link>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-rule-strong p-4 text-sm text-muted">Select a case to see its links. Hover to highlight its neighbours.</div>
        )}
        <div className="rounded-xl border border-rule bg-surface p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><GitMerge size={15} className="text-coord" aria-hidden />Cross-unit links</p>
          {crossUnit.length === 0 ? <p className="mt-1 text-xs text-muted">None. Every link stays within one unit.</p> : (
            <ul className="mt-2 flex flex-col gap-1.5 text-xs">
              {crossUnit.slice(0, 8).map((l) => (
                <li key={l.a + l.b}>
                  <button type="button" className="flex w-full flex-col rounded-md px-1.5 py-1 text-left hover:bg-surface-2" onClick={() => setSelected(l.a)}>
                    <span><span className="font-mono">{l.a}</span> <span className="text-muted">· {unitOf.get(l.a)}</span></span>
                    <span><span className="text-muted">↔</span> <span className="font-mono">{l.b}</span> <span className="text-muted">· {unitOf.get(l.b)}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted">Similarity is evidence for review, not proof two cases are the same.</p>
        </div>
      </aside>
    </div>
  );
}
