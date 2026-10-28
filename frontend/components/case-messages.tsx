"use client";

/**
 * Secure case-linked messaging (ministry note p. 16). One thread per case for the units that can see its content;
 * access starts and ends with custody, coordination, assistance or a pending transfer. Messages cannot be edited or
 * deleted, each carries a SHA-256 recorded in the audit chain, and notifications never include the text.
 */
import { ClipboardList, Fingerprint, Lock, MessagesSquare, Send, ShieldCheck, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { api, revalidate, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { CaseMessage, CaseThread } from "@/lib/types";
import { useToast } from "./toast";
import { Badge, Button, Card, EmptyState, ErrorNote, ErrorState, Field, Modal, Skeleton, cx, fieldA11y, inputCls } from "./ui";

const MAX = 4000;

function MessageTaskDialog({ caseNo, m, onClose, onDone }: { caseNo: string; m: CaseMessage; onClose: () => void; onDone: (msg: string) => void }) {
  const [title, setTitle] = useState(m.body.slice(0, 300));
  const [due, setDue] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/cases/${caseNo}/messages/${m.id}/task`, { json: { title, due_on: due || null } });
      onDone("Task added from the message.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Turn this message into a task" description={`${m.unit} · ${m.author}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={title.trim().length < 3} onClick={go} icon={<ClipboardList size={15} aria-hidden />}>Add task</Button></>}>
      <div className="flex flex-col gap-3">
        <Field id="mt-title" label="Task" required hint="Owned by you; it appears as the case's next action when it is the earliest due.">
          <input {...fieldA11y("mt-title", undefined, true)} className={inputCls} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field id="mt-due" label="Due date (optional)">
          <input id="mt-due" type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

function Bubble({ m, canTask, onTask }: { m: CaseMessage; canTask: boolean; onTask: () => void }) {
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cx("flex flex-col gap-1", m.mine ? "items-end" : "items-start")} data-testid="case-message">
      <p className="flex items-center gap-2 px-1 text-xs text-muted">
        <span className="font-semibold text-ink">{m.mine ? "You" : m.author}</span>
        <Badge tone={m.mine ? "info" : "neutral"}>{m.unit}</Badge>
        <time dateTime={m.at}>{fmtDateTime(m.at)}</time>
      </p>
      <div className={cx("max-w-[min(560px,92%)] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14.5px] leading-relaxed",
        m.mine ? "rounded-tr-md bg-action text-white" : "rounded-tl-md border border-rule bg-surface")}>
        {m.body}
      </div>
      <p className="flex items-center gap-3 px-1 text-[11px] text-muted">
        <span className="flex items-center gap-1 font-mono" title={`SHA-256 ${m.sha256} — recorded in the audit chain`}><Fingerprint size={11} aria-hidden />{m.sha256.slice(0, 12)}</span>
        {canTask && <button type="button" onClick={onTask} className="font-medium text-action-ink hover:underline">Make a task</button>}
      </p>
    </motion.li>
  );
}

export function CaseMessages({ caseNo, tier, holder, onChanged }: { caseNo: string; tier: "full" | "metadata"; holder: string; onChanged: () => void }) {
  const toast = useToast();
  const { data, error, isLoading, mutate } = useApi<CaseThread>(tier === "full" ? `/cases/${caseNo}/messages` : null, { refreshInterval: 15000 });
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [postError, setPostError] = useState<unknown>(null);
  const [taskFrom, setTaskFrom] = useState<CaseMessage | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const count = data?.items.length ?? 0;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  if (tier !== "full") {
    return (
      <EmptyState title="The thread is restricted" icon={<Lock size={20} />}>
        Messages on this case are visible to {holder} and to units coordinating on it, assisting with it or offered it by transfer.
      </EmptyState>
    );
  }
  if (isLoading) return <Card><div className="flex flex-col gap-3"><Skeleton className="h-14 w-2/3" /><Skeleton className="ml-auto h-14 w-1/2" /><Skeleton className="h-14 w-3/5" /></div></Card>;
  if (error || !data) return <ErrorState error={error} onRetry={() => mutate()} />;

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setPostError(null);
    try {
      const m = await api<CaseMessage>(`/cases/${caseNo}/messages`, { json: { body: text } });
      setBody("");
      await mutate({ ...data, items: [...data.items, m] }, { revalidate: true });
    } catch (e) {
      setPostError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card padded={false}>
        <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><MessagesSquare size={17} className="text-action" aria-hidden />Case thread</h2>
          <span className="text-xs text-muted">{count} message{count === 1 ? "" : "s"} · refreshes every 15 s</span>
        </div>
        {count === 0 ? (
          <div className="px-5 py-10"><EmptyState compact title="No messages yet" icon={<MessagesSquare size={20} />}>Agree next steps with the other units here instead of by e-mail, so the conversation stays with the case.</EmptyState></div>
        ) : (
          <ol ref={listRef} className="flex max-h-[520px] flex-col gap-4 overflow-y-auto px-5 py-5" aria-label="Messages" aria-live="polite">
            <AnimatePresence initial={false}>
              {data.items.map((m) => <Bubble key={m.id} m={m} canTask={data.can_make_task} onTask={() => setTaskFrom(m)} />)}
            </AnimatePresence>
          </ol>
        )}
        <div className="border-t border-rule px-5 py-4">
          {data.can_post ? (
            <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex flex-col gap-2">
              <label htmlFor="msg-body" className="sr-only">Message</label>
              <textarea id="msg-body" value={body} maxLength={MAX} onChange={(e) => setBody(e.target.value)} rows={3}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
                className={cx(inputCls, "min-h-20 resize-y")} placeholder="Write to the units on this case. Avoid copying the complainant's personal details." />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted">{body.length > MAX - 400 ? `${MAX - body.length} characters left · ` : ""}Ctrl/⌘ + Enter to send. Messages cannot be edited or deleted.</span>
                <Button type="submit" busy={busy} disabled={!body.trim()} icon={<Send size={15} aria-hidden />}>Send</Button>
              </div>
              <ErrorNote error={postError} />
            </form>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted"><Lock size={14} aria-hidden />You can read this thread. Writing is for case-working roles while the case is open.</p>
          )}
        </div>
      </Card>
      <aside className="flex flex-col gap-5">
        <Card title="Who can read this thread" description="Access follows the case and ends when the reason for it ends.">
          <ul className="flex flex-col gap-2.5">
            {data.participants.map((p) => (
              <li key={p.unit} className="flex items-center gap-3 text-sm">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-action-soft text-[11px] font-bold text-action-ink" aria-hidden>{p.unit.slice(0, 4)}</span>
                <span><b>{p.unit}</b><span className="block text-xs text-muted">{p.why}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-start gap-1.5 border-t border-rule pt-3 text-xs text-muted"><Users size={13} className="mt-0.5 shrink-0" aria-hidden />Also readable by the Competent Authority and auditors under the access policy.</p>
        </Card>
        <Card title="How this thread is protected">
          <ul className="flex flex-col gap-2 text-sm">
            <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden />Row-level security in the database, not only in the screen.</li>
            <li className="flex gap-2"><Fingerprint size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden />Insert-only; each message&apos;s SHA-256 is in the audit chain.</li>
            <li className="flex gap-2"><Lock size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden />Notifications name the case and unit, never the text.</li>
          </ul>
        </Card>
      </aside>
      {taskFrom && (
        <MessageTaskDialog caseNo={caseNo} m={taskFrom} onClose={() => setTaskFrom(null)}
          onDone={(msg) => { setTaskFrom(null); toast({ kind: "success", title: msg }); revalidate("/tasks"); onChanged(); }} />
      )}
    </div>
  );
}
