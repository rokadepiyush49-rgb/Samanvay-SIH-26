"use client";

import { ArrowRight, Briefcase, Building2, CornerDownLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { CaseList, InstitutionListItem } from "@/lib/types";
import { cx } from "../ui";
import { visibleNav } from "./nav";

type Result = { id: string; group: string; label: string; hint?: string; href: string; icon: ReactNode };

/** Global search and page jump (Ctrl/⌘ K). Case and institution lookups go to the same APIs as the register. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { me, t } = useSession();
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<{ q: string; items: Result[] }>({ q: "", items: [] });
  const [active, setActive] = useState(0);

  const pages = useMemo<Result[]>(
    () => visibleNav(me).flatMap((g) => g.items.map((i) => ({ id: `p:${i.href}`, group: "Pages", label: t(i.key), hint: t(g.key), href: i.href, icon: <i.icon size={16} aria-hidden /> }))),
    [me, t],
  );

  const term = q.trim();
  useEffect(() => {
    if (!open || term.length < 2) return;
    const ctrl = { cancelled: false };
    const id = setTimeout(async () => {
      const [cases, insts] = await Promise.all([
        api<CaseList>(`/cases${qs({ q: term, limit: 5 })}`).catch(() => null),
        api<{ items: InstitutionListItem[] }>(`/institutions${qs({ q: term, limit: 5 })}`).catch(() => null),
      ]);
      if (ctrl.cancelled) return;
      setRemote({
        q: term,
        items: [
          ...(cases?.items ?? []).map((c) => ({ id: `c:${c.id}`, group: "Cases", label: c.case_no, hint: `${c.institution?.name ?? c.institution_raw ?? "Unresolved institution"} · ${c.holding_unit.code} · ${c.status_label}`, href: `/cases/${c.case_no}`, icon: <Briefcase size={16} aria-hidden /> })),
          ...(insts?.items ?? []).map((i) => ({ id: `i:${i.id}`, group: "Institutions", label: i.name, hint: `${i.city} · ${i.permanent_id} · ${i.open_cases} open`, href: `/institutions/${i.permanent_id}`, icon: <Building2 size={16} aria-hidden /> })),
        ],
      });
    }, 220);
    return () => {
      ctrl.cancelled = true;
      clearTimeout(id);
    };
  }, [term, open]);

  const results = useMemo(() => {
    const ql = term.toLowerCase();
    const matchedPages = pages.filter((p) => !ql || p.label.toLowerCase().includes(ql) || p.hint?.toLowerCase().includes(ql));
    const found = term.length >= 2 && remote.q === term ? remote.items : [];
    const searchAll: Result[] = term ? [{ id: "search", group: "Search", label: `Search all cases for “${term}”`, href: `/cases${qs({ q: term })}`, icon: <Search size={16} aria-hidden /> }] : [];
    return [...searchAll, ...found, ...matchedPages.slice(0, term ? 6 : 20)];
  }, [pages, remote, term]);

  const go = (r: Result | undefined) => {
    if (!r) return;
    onOpenChange(false);
    setQ("");
    router.push(r.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
  };

  let lastGroup = "";
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setQ(""); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-rule bg-surface text-ink shadow-pop focus:outline-none">
          <Dialog.Title className="sr-only">Search Samanvay</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-rule px-4">
            <Search size={18} className="text-muted" aria-hidden />
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey}
              role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"
              aria-activedescendant={results[active] ? `pal-${results[active].id}` : undefined}
              placeholder="Case no., institution, Permanent ID or page…" aria-label="Search"
              className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted" />
            <kbd className="hidden rounded border border-rule px-1.5 py-0.5 text-[11px] text-muted sm:block">Esc</kbd>
          </div>
          <ul id="palette-list" role="listbox" aria-label="Results" className="max-h-[55vh] overflow-y-auto py-2">
            {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No matches.</li>}
            {results.map((r, i) => {
              const header = r.group !== lastGroup ? r.group : null;
              lastGroup = r.group;
              return (
                <li key={r.id} role="presentation">
                  {header && <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted" aria-hidden>{header}</p>}
                  <div id={`pal-${r.id}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(r)}
                    className={cx("mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm", i === active ? "bg-action-soft text-action-ink" : "text-ink")}>
                    <span className="text-muted" aria-hidden>{r.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className={cx("block truncate font-medium", r.group === "Cases" && "font-mono text-[13px]")}>{r.label}</span>
                      {r.hint && <span className="block truncate text-xs text-muted">{r.hint}</span>}
                    </span>
                    {i === active ? <CornerDownLeft size={14} aria-hidden /> : <ArrowRight size={14} className="opacity-0" aria-hidden />}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-rule bg-surface-2/60 px-4 py-2 text-[11px] text-muted">
            Tip: <span className="font-mono">pid:1-…</span>, <span className="font-mono">id:SMV-…</span> and <span className="font-mono">unit:RB</span> work in search. ↑ ↓ to move, Enter to open.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
