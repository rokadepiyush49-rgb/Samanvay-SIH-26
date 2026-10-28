"use client";

/**
 * Case assistant: an AI-generated summary of the case and answers to an officer's questions, retrieved from the case
 * file (as this officer may see it) and Samanvay's configured rules. Every statement cites its passages, shown alongside.
 * Offline mode composes text from the passages with rules; Claude mode (AI_PROVIDER=anthropic) writes from the same ones.
 */
import {
  AlertTriangle, BookOpen, Bot, ClipboardList, FileText, GitMerge, History, LifeBuoy, ListTodo, MessagesSquare, Paperclip,
  RefreshCw, Repeat, Route, Send, Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { AssistantAnswer, AssistantSource, AssistantSummary } from "@/lib/types";
import { Badge, Button, Card, ErrorNote, ErrorState, Skeleton, cx, inputCls } from "./ui";

const KIND: Record<AssistantSource["kind"], { label: string; icon: ReactNode }> = {
  FACTS: { label: "Case facts", icon: <ClipboardList size={14} aria-hidden /> },
  COMPLAINT: { label: "Complaint", icon: <FileText size={14} aria-hidden /> },
  EVENT: { label: "History", icon: <History size={14} aria-hidden /> },
  TASK: { label: "Task", icon: <ListTodo size={14} aria-hidden /> },
  LINK: { label: "Related case", icon: <GitMerge size={14} aria-hidden /> },
  ASSIST: { label: "Assistance", icon: <LifeBuoy size={14} aria-hidden /> },
  DOCUMENT: { label: "Document", icon: <Paperclip size={14} aria-hidden /> },
  MESSAGE: { label: "Message", icon: <MessagesSquare size={14} aria-hidden /> },
  ROUTING: { label: "Routing check", icon: <Route size={14} aria-hidden /> },
  ISSUE: { label: "Recurring issue", icon: <Repeat size={14} aria-hidden /> },
  RULE: { label: "Operating rule", icon: <BookOpen size={14} aria-hidden /> },
};

const SUGGESTED = [
  "When is this case due?",
  "Who holds this case and since when?",
  "What is the next step?",
  "Are there related cases in other units?",
  "What have the units said in messages?",
  "What happens if I issue a show-cause notice now?",
];

type Focus = { result: string; id: string | null };

function Cite({ id, active, onClick }: { id: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} title={`Show source ${id}`}
      className={cx("mx-0.5 inline-flex h-5 items-center rounded-md px-1.5 align-[1px] font-mono text-[11px] font-semibold transition-colors",
        active ? "bg-action text-white" : "bg-action-soft text-action-ink hover:bg-action hover:text-white")}>
      {id}
    </button>
  );
}

/** Renders "text [C1] more [E12]" with the bracketed IDs as citation buttons. */
function Cited({ text, focus, result, onCite }: { text: string; focus: Focus; result: string; onCite: (f: Focus) => void }) {
  const parts = text.split(/\[([A-Z]+\d+)\]/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1
        ? <Cite key={i} id={p} active={focus.result === result && focus.id === p} onClick={() => onCite({ result, id: p })} />
        : <span key={i}>{p}</span>))}
    </>
  );
}

function ModeBadge({ mode, model }: { mode: "offline" | "claude"; model: string | null }) {
  return mode === "claude"
    ? <Badge tone="coord" icon={<Sparkles size={12} aria-hidden />} title="Written by Claude from the cited passages">Claude{model ? ` · ${model}` : ""}</Badge>
    : <Badge tone="navy" icon={<Bot size={12} aria-hidden />} title="No language model: assembled from retrieved passages by rules; nothing leaves the server">Offline · retrieval + rules</Badge>;
}

function SourcePanel({ sources, active, caseNo }: { sources: AssistantSource[]; active: string | null; caseNo: string }) {
  if (sources.length === 0) return <p className="text-sm text-muted">No passages were cited.</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {sources.map((s) => {
        const k = KIND[s.kind] ?? KIND.FACTS;
        const href = s.kind === "LINK" && s.ref.case_no ? `/cases/${s.ref.case_no}` : s.kind === "EVENT" ? `/cases/${caseNo}?tab=timeline` : s.kind === "MESSAGE" ? `/cases/${caseNo}?tab=messages` : null;
        return (
          <motion.li key={s.id} layout id={`src-${s.id}`}
            className={cx("rounded-xl border p-3 text-sm transition-colors", active === s.id ? "border-action bg-action-soft/60 shadow-card" : "border-rule bg-surface")}>
            <p className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-muted">{k.icon}{s.kind === "RULE" ? s.title : k.label}</span>
              <span className="font-mono font-semibold text-action-ink">{s.id}</span>
            </p>
            <p className={cx("mt-1.5 leading-relaxed", active === s.id ? "" : "line-clamp-4")}>{s.text}</p>
            {href && <Link href={href} className="mt-1.5 inline-block text-xs font-medium text-action-ink hover:underline">Open</Link>}
            {s.kind === "RULE" && <p className="mt-1.5 text-[11px] text-muted">How Samanvay is configured, not regulation text.</p>}
          </motion.li>
        );
      })}
    </ul>
  );
}

export function CaseAssistant({ caseNo, tier }: { caseNo: string; tier: "full" | "metadata" }) {
  const summary = useSWR<AssistantSummary>(`assistant:${caseNo}`, () => api<AssistantSummary>(`/cases/${caseNo}/assistant/summary`, { method: "POST" }), { revalidateOnFocus: false, shouldRetryOnError: false });
  const [turns, setTurns] = useState<AssistantAnswer[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [askError, setAskError] = useState<unknown>(null);
  const [focus, setFocus] = useState<Focus>({ result: "summary", id: null });

  const ask = async (question: string) => {
    const text = question.trim();
    if (text.length < 3 || busy) return;
    setBusy(true);
    setAskError(null);
    try {
      const a = await api<AssistantAnswer>(`/cases/${caseNo}/assistant/ask`, { json: { question: text } });
      setTurns((t) => [...t, a]);
      setFocus({ result: `q${turns.length}`, id: a.sources[0]?.id ?? null });
      setQ("");
    } catch (e) {
      setAskError(e);
    } finally {
      setBusy(false);
    }
  };

  const s = summary.data;
  const focused = focus.result === "summary" ? s : turns[Number(focus.result.slice(1))];
  const cite = (f: Focus) => {
    setFocus(f);
    requestAnimationFrame(() => document.getElementById(`src-${f.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Sparkles size={17} className="text-coord" aria-hidden />AI case summary</h2>
            <span className="flex flex-wrap items-center gap-2">
              {s && <ModeBadge mode={s.mode} model={s.model} />}
              <Button size="sm" variant="ghost" onClick={() => void summary.mutate()} busy={summary.isValidating} icon={<RefreshCw size={14} aria-hidden />}>Regenerate</Button>
            </span>
          </div>
          <div className="p-5">
            {summary.error ? <ErrorState error={summary.error} onRetry={() => void summary.mutate()} /> : !s ? (
              <div className="flex flex-col gap-3" aria-busy="true" aria-label="Writing the summary"><Skeleton className="h-6 w-3/4" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" /></div>
            ) : (
              <div>
                {s.note && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn-ink">{s.note}</p>}
                <p className="text-[17px] font-semibold leading-snug" data-testid="ai-headline">{s.headline}</p>
                <ul className="mt-3 flex flex-col gap-2.5">
                  {s.points.map((p, i) => (
                    <li key={i} className="flex gap-2.5 text-[14.5px] leading-relaxed">
                      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-action" aria-hidden />
                      <span>{p.text}{p.sources.map((id) => <Cite key={id} id={id} active={focus.result === "summary" && focus.id === id} onClick={() => cite({ result: "summary", id })} />)}</span>
                    </li>
                  ))}
                </ul>
                {s.missing.length > 0 && (
                  <div className="mt-4 rounded-xl border border-warn/30 bg-warn-soft/60 p-3.5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warn-ink"><AlertTriangle size={13} aria-hidden />Missing or overdue</p>
                    <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm text-warn-ink">{s.missing.map((m) => <li key={m}>{m}</li>)}</ul>
                  </div>
                )}
                <p className="mt-4 text-xs text-muted">Generated {fmtDateTime(s.generated_at)}{tier === "metadata" ? " from the metadata you can see; complaint text, documents and messages were not used." : "."}</p>
              </div>
            )}
          </div>
        </Card>

        <Card padded={false}>
          <div className="border-b border-rule px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Bot size={17} className="text-action" aria-hidden />Ask about this case</h2>
            <p className="mt-0.5 text-xs text-muted">Answers come only from this case file and Samanvay&apos;s rules, each with its source. Nothing here changes the case.</p>
          </div>
          <div className="flex flex-col gap-4 p-5">
            <AnimatePresence initial={false}>
              {turns.map((t, i) => (
                <motion.div key={t.generated_at + i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2" data-testid="ai-answer">
                  <p className="self-end rounded-2xl rounded-tr-md bg-surface-2 px-4 py-2 text-sm font-medium">{t.question}</p>
                  <div className={cx("rounded-2xl rounded-tl-md border px-4 py-3 text-[14.5px] leading-relaxed", t.found ? "border-rule bg-surface" : "border-dashed border-rule-strong bg-surface text-muted")}>
                    {t.note && <p className="mb-2 rounded-md bg-warn-soft px-2 py-1 text-xs text-warn-ink">{t.note}</p>}
                    {t.answer.split("\n").map((line, j) => <p key={j} className={j ? "mt-1.5" : ""}><Cited text={line} focus={focus} result={`q${i}`} onCite={cite} /></p>)}
                    <p className="mt-2 flex items-center gap-2"><ModeBadge mode={t.mode} model={t.model} /></p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {busy && <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>}
            {turns.length === 0 && (
              <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
                {SUGGESTED.map((x) => (
                  <button key={x} type="button" onClick={() => void ask(x)} disabled={busy}
                    className="rounded-full border border-rule bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:border-action hover:text-action-ink disabled:opacity-60">{x}</button>
                ))}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} className="flex gap-2">
              <label htmlFor="ai-q" className="sr-only">Your question</label>
              <input id="ai-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} className={inputCls} placeholder="e.g. Has an interim reply been sent?" autoComplete="off" />
              <Button type="submit" busy={busy} disabled={q.trim().length < 3} icon={<Send size={15} aria-hidden />}>Ask</Button>
            </form>
            <ErrorNote error={askError} />
          </div>
        </Card>
      </div>

      <aside className="xl:sticky xl:top-4 xl:self-start">
        <Card title="Sources" description={focus.result === "summary" ? "Passages cited in the summary. Select a citation to highlight it." : "Passages cited in the selected answer."}>
          {focused ? <div className="max-h-[70vh] overflow-y-auto pr-1"><SourcePanel sources={focused.sources} active={focus.id} caseNo={caseNo} /></div> : <Skeleton className="h-24 w-full" />}
          {focused && (
            <p className="mt-3 border-t border-rule pt-3 text-xs text-muted">
              {focused.mode === "claude" ? "Claude wrote this from the passages above; the case content was sent to Anthropic's API." : "No language model ran: the text was assembled from the passages above, and nothing left the server."}
            </p>
          )}
        </Card>
      </aside>
    </div>
  );
}
