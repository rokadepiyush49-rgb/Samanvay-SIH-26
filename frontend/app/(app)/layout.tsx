"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { MotionProvider } from "@/components/motion";
import { Shell } from "@/components/shell";
import { ToastProvider } from "@/components/toast";
import { Spinner } from "@/components/ui";
import { ApiError, api, clearPrivateCache } from "@/lib/api";
import { SessionProvider, applyPrefs, readPrefs, useSession } from "@/lib/session";
import type { Me } from "@/lib/types";

function Providers({ children }: { children: ReactNode }) {
  const { prefs } = useSession();
  return (
    <MotionProvider reduce={prefs.reduceMotion}>
      <ToastProvider>
        <Shell>{children}</Shell>
      </ToastProvider>
    </MotionProvider>
  );
}

/** Protected area: every page below renders only after /auth/me confirms a live server session. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState<unknown>(null);

  useEffect(() => {
    applyPrefs(readPrefs());
    const toLogin = (reason: string) => {
      clearPrivateCache();
      router.replace(`/login?reason=${reason}&next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    };
    const check = () =>
      api<Me>("/auth/me")
        .then(setMe)
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) toLogin("signin");
          else setFailed(e);
        });
    void check();
    // Keep the 30-minute sliding session alive while the page is open; a revoked session sends the user to sign in.
    const id = setInterval(() => api("/auth/refresh", { method: "POST" }).catch((e) => e instanceof ApiError && e.status === 401 && toLogin("expired")), 10 * 60 * 1000);
    // Pages restored from the back-forward cache after sign-out must re-check the session.
    const onShow = (e: PageTransitionEvent) => e.persisted && void check();
    window.addEventListener("pageshow", onShow);
    return () => {
      clearInterval(id);
      window.removeEventListener("pageshow", onShow);
    };
  }, [router]);

  if (failed) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="max-w-md rounded-xl border border-rule bg-surface p-6 text-center shadow-card" role="alert">
          <p className="font-semibold">Samanvay is not reachable</p>
          <p className="mt-1 text-sm text-muted">The API did not respond. Check that the server is running, then reload.</p>
          <button className="mt-4 rounded-lg bg-action px-4 py-2 text-sm font-semibold text-white" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
  if (!me) return <div className="grid min-h-screen place-items-center"><Spinner label="Checking your session…" /></div>;
  return (
    <SessionProvider initial={me}>
      <Providers>{children}</Providers>
    </SessionProvider>
  );
}
