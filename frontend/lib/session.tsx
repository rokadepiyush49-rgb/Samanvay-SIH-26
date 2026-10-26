"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Me } from "./types";

type Lang = "en" | "hi";

const STRINGS: Record<string, { en: string; hi: string }> = {
  desk: { en: "Bureau Desk", hi: "ब्यूरो डेस्क" },
  cases: { en: "All cases", hi: "सभी मामले" },
  coordination: { en: "Coordination Centre", hi: "समन्वय केंद्र" },
  institutions: { en: "Institutions", hi: "संस्थान" },
  cockpit: { en: "Management Cockpit", hi: "प्रबंधन कॉकपिट" },
  reports: { en: "Reports", hi: "रिपोर्ट" },
  imports: { en: "Register Importer", hi: "रजिस्टर आयात" },
  benchmark: { en: "Matching benchmark", hi: "मिलान बेंचमार्क" },
  admin: { en: "Admin", hi: "प्रशासन" },
  audit: { en: "Audit", hi: "लेखा परीक्षा" },
  newCase: { en: "New case", hi: "नया मामला" },
  search: { en: "Search institution, case no, pid:1-…", hi: "संस्थान, मामला सं., pid:1-… खोजें" },
  signOut: { en: "Sign out", hi: "साइन आउट" },
  notifications: { en: "Notifications", hi: "सूचनाएं" },
  updated: { en: "Updated", hi: "अद्यतन" },
};

type Ctx = { me: Me | null; setMe: (m: Me | null) => void; lang: Lang; setLang: (l: Lang) => void; t: (k: string) => string };

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children, initial }: { children: ReactNode; initial: Me | null }) {
  const [me, setMe] = useState<Me | null>(initial);
  // Rendered only after the session is fetched on the client, so reading storage here cannot cause a hydration mismatch.
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem("smv_lang");
      return saved === "hi" ? "hi" : "en";
    } catch {
      return "en";
    }
  });
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("smv_lang", l);
    } catch {
      /* ignore */
    }
  }, []);
  const t = useCallback((k: string) => STRINGS[k]?.[lang] ?? STRINGS[k]?.en ?? k, [lang]);
  return <SessionCtx.Provider value={{ me, setMe, lang, setLang, t }}>{children}</SessionCtx.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}

export function hasRole(me: Me | null, ...roles: string[]): boolean {
  return !!me && roles.some((r) => me.roles.includes(r));
}
