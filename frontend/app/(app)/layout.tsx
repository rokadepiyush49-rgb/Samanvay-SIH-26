"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { MotionProvider } from "@/components/motion";
import { Shell } from "@/components/shell";
import { Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { SessionProvider } from "@/lib/session";
import type { Me } from "@/lib/types";

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api<Me>("/auth/me")
      .then(setMe)
      .catch(() => {
        setMe(null);
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      });
    // Keep the 30-minute sliding session alive while the page is open.
    const id = setInterval(() => api("/auth/refresh", { method: "POST" }).catch(() => undefined), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [router]);
  if (!me) return <Spinner label="Checking your session…" />;
  return (
    <SessionProvider initial={me}>
      <MotionProvider>
        <Shell>{children}</Shell>
      </MotionProvider>
    </SessionProvider>
  );
}
