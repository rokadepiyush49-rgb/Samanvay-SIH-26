"use client";

import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

type Kind = "success" | "error" | "info";
type ToastT = { id: number; kind: Kind; title: string; detail?: string };

const ToastCtx = createContext<(t: Omit<ToastT, "id">) => void>(() => undefined);

/** Confirmation messages for completed actions. Only call after the API has confirmed the result. */
export function useToast() {
  return useContext(ToastCtx);
}

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info };
const TONE = { success: "border-ok/30 text-ok", error: "border-danger/30 text-danger", info: "border-action/30 text-action" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastT[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<ToastT, "id">) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === "error" ? 9000 : 5000);
    },
    [dismiss],
  );
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const Icon = ICON[t.kind];
            return (
              <motion.div key={t.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                className={cx("pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface px-4 py-3 shadow-pop", TONE[t.kind])}>
                <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1 text-sm text-ink">
                  <p className="font-semibold">{t.title}</p>
                  {t.detail && <p className="mt-0.5 text-muted">{t.detail}</p>}
                </div>
                <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Dismiss"><X size={16} /></button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
