"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, clearPrivateCache } from "./api";
import { translate, type Lang } from "./i18n";
import type { Me } from "./types";

export type TextSize = "default" | "large" | "larger";
export type Prefs = { lang: Lang; textSize: TextSize; reduceMotion: boolean };

const DEFAULT_PREFS: Prefs = { lang: "en", textSize: "default", reduceMotion: false };

/** Display preferences are per-browser conveniences (not security-relevant), so localStorage is fine. */
export function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem("smv_prefs") ?? "{}") as Partial<Prefs>;
    const legacy = localStorage.getItem("smv_lang");
    return {
      lang: raw.lang === "hi" || legacy === "hi" ? "hi" : "en",
      textSize: raw.textSize === "large" || raw.textSize === "larger" ? raw.textSize : "default",
      reduceMotion: raw.reduceMotion === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function applyPrefs(p: Prefs): void {
  const el = document.documentElement;
  el.lang = p.lang;
  el.dataset.textSize = p.textSize;
  el.dataset.reduceMotion = String(p.reduceMotion);
}

type Ctx = {
  me: Me;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: string) => string;
  /** Components with unsaved edits register here so sign-out can warn first. Returns an unregister function. */
  registerDirty: (id: string, dirty: boolean) => void;
  hasUnsaved: () => boolean;
  signOut: (opts?: { force?: boolean }) => Promise<boolean>;
};

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children, initial }: { children: ReactNode; initial: Me }) {
  const router = useRouter();
  // Rendered only after the session is fetched on the client, so reading storage here cannot cause a hydration mismatch.
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const dirty = useRef(new Set<string>());

  useEffect(() => applyPrefs(prefs), [prefs]);

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((old) => {
      const next = { ...old, ...p };
      try {
        localStorage.setItem("smv_prefs", JSON.stringify(next));
      } catch {
        /* storage unavailable: preference lasts for this tab only */
      }
      return next;
    });
  }, []);

  const registerDirty = useCallback((id: string, isDirty: boolean) => {
    if (isDirty) dirty.current.add(id);
    else dirty.current.delete(id);
  }, []);
  const hasUnsaved = useCallback(() => dirty.current.size > 0, []);

  const signOut = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!opts?.force && dirty.current.size > 0) return false;
      // Revoke the server session first (the cookie is httpOnly); then drop every cached response.
      await api("/auth/logout", { method: "POST" }).catch(() => undefined);
      dirty.current.clear();
      clearPrivateCache();
      router.replace("/login?signed_out=1");
      return true;
    },
    [router],
  );

  const value = useMemo<Ctx>(
    () => ({
      me: initial,
      prefs,
      setPrefs,
      lang: prefs.lang,
      setLang: (lang) => setPrefs({ lang }),
      t: (k) => translate(k, prefs.lang),
      registerDirty,
      hasUnsaved,
      signOut,
    }),
    [initial, prefs, setPrefs, registerDirty, hasUnsaved, signOut],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}

/** Marks a form as having unsaved changes: warns on tab close and lets sign-out ask before discarding. */
export function useUnsavedChanges(id: string, isDirty: boolean): void {
  const { registerDirty } = useSession();
  useEffect(() => {
    registerDirty(id, isDirty);
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      registerDirty(id, false);
    };
  }, [id, isDirty, registerDirty]);
}

export { hasRole } from "./permissions";
