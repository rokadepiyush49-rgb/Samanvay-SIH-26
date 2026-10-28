"use client";

/**
 * Case tasks — "what must happen next, and by when" (ministry note p. 4): an owner unit and officer, a deadline, a
 * status and an optional dependency. Joint actions agreed in coordination and coordination-room messages become tasks.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Circle, ClipboardCheck, Link2, ListTodo, Lock, Network, Plus, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api, revalidate, useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { taskSchema, type TaskForm } from "@/lib/schemas";
import { useSession, useUnsavedChanges } from "@/lib/session";
import type { CaseDetail, CaseTask, Meta, TaskList } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, cx, fieldA11y, inputCls } from "./ui";

export function TaskDue({ t }: { t: CaseTask }) {
  if (t.status !== "OPEN") return <span className="text-xs text-muted">{t.status === "DONE" ? `Done ${fmtDate(t.done_at)}` : "Cancelled"}</span>;
  if (!t.due_on) return <span className="text-xs text-muted">No deadline</span>;
  return <span className={cx("text-xs tabular", t.overdue ? "font-semibold text-danger" : "text-muted")}>{t.overdue ? "Overdue · " : "Due "}{fmtDate(t.due_on)}</span>;
}

export function TaskItem({ t, showCase, onClose }: { t: CaseTask; showCase?: boolean; onClose: (t: CaseTask, mode: "complete" | "cancel") => void }) {
  const open = t.status === "OPEN";
  return (
    <li className="flex items-start gap-3 px-5 py-3.5" data-testid="task-row">
      <button type="button" disabled={!t.can_complete} onClick={() => onClose(t, "complete")}
        aria-label={t.can_complete ? `Mark “${t.title}” done` : open ? (t.blocked ? "Blocked by another task" : "You cannot complete this task") : "Done"}
        className={cx("mt-0.5 shrink-0 rounded-full", t.can_complete ? "text-action hover:text-ok" : "text-muted", !open && "text-ok")}>
        {!open ? <CheckCircle2 size={20} aria-hidden /> : t.blocked ? <Lock size={18} aria-hidden /> : <Circle size={20} aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cx("text-sm font-medium", !open && "text-muted line-through")}>{t.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{t.owner_unit}{t.owner ? ` · ${t.owner}` : ""}</span>
          <TaskDue t={t} />
          {showCase && <Link href={`/cases/${t.case_no}`} className="font-mono text-action-ink hover:underline">{t.case_no}</Link>}
          {t.source === "COORDINATION" && <Badge tone="coord" icon={<Network size={11} aria-hidden />}>Joint action {t.source_ref}</Badge>}
          {t.source === "MESSAGE" && <Badge tone="coord" icon={<Network size={11} aria-hidden />}>From {t.source_ref} room</Badge>}
        </p>
        {t.blocked && t.depends_on && <p className="mt-1 flex items-center gap-1 text-xs text-warn"><Link2 size={12} aria-hidden />Waits for “{t.depends_on.title}”</p>}
        {t.done_note && <p className="mt-1 text-xs text-muted">“{t.done_note}”</p>}
      </div>
      {t.can_cancel && <Button size="sm" variant="ghost" onClick={() => onClose(t, "cancel")} aria-label={`Cancel task “${t.title}”`}><XCircle size={15} aria-hidden /></Button>}
    </li>
  );
}

export function TaskCloseDialog({ task, mode, onClose, onDone }: { task: CaseTask; mode: "complete" | "cancel"; onClose: () => void; onDone: (msg: string) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const cancel = mode === "cancel";
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/tasks/${task.id}/${mode}`, { json: cancel ? { reason: text } : { note: text || null }, headers: { "if-match": String(task.row_version) } });
      onDone(cancel ? "Task cancelled." : `Done: ${task.title}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={cancel ? "Cancel this task?" : "Mark this task done"} description={task.title}
      footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button busy={busy} variant={cancel ? "danger" : "primary"} disabled={cancel && text.trim().length < 5} onClick={go}>{cancel ? "Cancel task" : "Mark done"}</Button></>}>
      <Field id="tc-text" label={cancel ? "Reason" : "Note (optional)"} required={cancel} hint={cancel ? "At least 5 characters. Recorded on the case timeline." : "What was done, for the case file."}>
        <textarea {...fieldA11y("tc-text", undefined, true)} className={cx(inputCls, "min-h-20")} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="mt-3"><ErrorNote error={error} /></div>
    </Modal>
  );
}

export function AddTaskDialog({ c, open, onClose, onDone }: { c: CaseDetail; open: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const { me } = useSession();
  const { data: meta } = useApi<Meta>(open ? "/meta" : null);
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting, isDirty } } = useForm<TaskForm>({
    resolver: zodResolver(taskSchema), defaultValues: { title: "", owner_unit: c.holding_unit.code, owner_id: "", due_on: "", depends_on: "" },
  });
  useUnsavedChanges(`task-${c.case_no}`, open && isDirty);
  const unit = useWatch({ control, name: "owner_unit" });
  const { data: officers } = useApi<{ items: { id: string; full_name: string; open_cases: number }[] }>(open && unit === me.unit.code ? `/units/${unit}/officers` : null);
  const openTasks = c.tasks.filter((t) => t.status === "OPEN");
  const close = () => { reset(); setError(null); onClose(); };
  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await api(`/cases/${c.case_no}/tasks`, {
        json: { title: v.title, owner_unit: v.owner_unit || undefined, owner_id: v.owner_id || undefined, due_on: v.due_on || undefined, depends_on: v.depends_on || undefined },
      });
      reset();
      onDone(`Task added for ${v.owner_unit}.`);
    } catch (e) {
      setError(e);
    }
  });
  return (
    <Modal open={open} onClose={close} title="Add a task" description="A next step with an owner and a deadline. The owner is notified; reminders go out the working day before it is due."
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button type="submit" form="task-form" busy={isSubmitting} icon={<Plus size={15} aria-hidden />}>Add task</Button></>}>
      <form id="task-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field id="tk-title" label="Task" required error={errors.title?.message}>
          <input {...register("title")} {...fieldA11y("tk-title", errors.title?.message)} className={inputCls} placeholder="e.g. Seek the institute's reply on certificate retention" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="tk-unit" label="Owning unit" hint="Another unit is notified if you give it the task.">
            <select {...register("owner_unit")} id="tk-unit" className={inputCls}>
              {meta?.units.map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}
              {!meta && <option value={c.holding_unit.code}>{c.holding_unit.code}</option>}
            </select>
          </Field>
          <Field id="tk-owner" label="Officer (optional)" hint={unit === me.unit.code ? "Leave empty for the whole unit." : "The other unit assigns its own officer."}>
            <select {...register("owner_id")} id="tk-owner" className={inputCls} disabled={unit !== me.unit.code}>
              <option value="">Whole unit</option>
              {officers?.items.map((o) => <option key={o.id} value={o.id}>{o.full_name} · {o.open_cases} open</option>)}
            </select>
          </Field>
          <Field id="tk-due" label="Due by"><input {...register("due_on")} id="tk-due" type="date" className={inputCls} /></Field>
          <Field id="tk-dep" label="Waits for (optional)" hint="Cannot be completed until that task is done.">
            <select {...register("depends_on")} id="tk-dep" className={inputCls} disabled={openTasks.length === 0}>
              <option value="">Nothing</option>
              {openTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </Field>
        </div>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

/** Tasks on this case: open first (earliest due), then the last few closed ones. */
export function TaskPanel({ c, onChanged }: { c: CaseDetail; onChanged: (msg: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState<{ t: CaseTask; mode: "complete" | "cancel" } | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const open = c.tasks.filter((t) => t.status === "OPEN");
  const closed = c.tasks.filter((t) => t.status !== "OPEN");
  return (
    <Card title="Next steps" description="Tasks with an owner and a deadline. Joint actions agreed in coordination appear here too."
      actions={c.can_add_task ? <Button size="sm" variant="secondary" onClick={() => setAdding(true)} icon={<Plus size={14} aria-hidden />}>Add task</Button> : undefined}
      padded={c.tasks.length === 0}>
      {c.tasks.length === 0 ? (
        <EmptyState compact title="No tasks on this case yet." icon={<ListTodo size={18} />}>{c.can_add_task ? "Add the next step so its owner and deadline are tracked." : undefined}</EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-rule" data-testid="task-list">{open.map((t) => <TaskItem key={t.id} t={t} onClose={(x, mode) => setClosing({ t: x, mode })} />)}</ul>
          {open.length === 0 && <p className="px-5 py-3 text-sm text-muted">All tasks are closed.</p>}
          {closed.length > 0 && (
            <div className="border-t border-rule">
              <button type="button" className="px-5 py-2.5 text-xs font-medium text-action hover:underline" aria-expanded={showClosed} onClick={() => setShowClosed((v) => !v)}>
                {showClosed ? "Hide" : "Show"} {closed.length} closed task{closed.length === 1 ? "" : "s"}
              </button>
              {showClosed && <ul className="divide-y divide-rule border-t border-rule">{closed.map((t) => <TaskItem key={t.id} t={t} onClose={() => undefined} />)}</ul>}
            </div>
          )}
        </>
      )}
      <AddTaskDialog key={`add-${adding}`} c={c} open={adding} onClose={() => setAdding(false)} onDone={(msg) => { setAdding(false); onChanged(msg); }} />
      {closing && <TaskCloseDialog task={closing.t} mode={closing.mode} onClose={() => setClosing(null)} onDone={(msg) => { setClosing(null); onChanged(msg); }} />}
    </Card>
  );
}

/** Desk card: open tasks for me (or unassigned in my unit), earliest due first. */
export function MyTasksCard() {
  const { data, mutate } = useApi<TaskList>("/tasks?scope=mine&state=open&limit=50", { refreshInterval: 60000 });
  const [closing, setClosing] = useState<{ t: CaseTask; mode: "complete" | "cancel" } | null>(null);
  const items = data?.items.slice(0, 6) ?? [];
  return (
    <Card title="My tasks" description={data ? `${data.counts.open} open · ${data.counts.overdue} overdue · ${data.counts.due_soon} due within 7 days` : "Loading"}
      actions={<ClipboardCheck size={18} className="text-muted" aria-hidden />} padded={items.length === 0}>
      {data && items.length === 0
        ? <EmptyState compact title="No open tasks for you." icon={<ListTodo size={18} />} />
        : <ul className="divide-y divide-rule" data-testid="my-tasks">{items.map((t) => <TaskItem key={t.id} t={t} showCase onClose={(x, mode) => setClosing({ t: x, mode })} />)}</ul>}
      {closing && (
        <TaskCloseDialog task={closing.t} mode={closing.mode} onClose={() => setClosing(null)}
          onDone={() => { setClosing(null); void mutate(); revalidate("/cases", "/tasks"); }} />
      )}
    </Card>
  );
}
