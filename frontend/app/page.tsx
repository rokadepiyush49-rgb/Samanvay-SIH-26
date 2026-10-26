"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    api<Me>("/auth/me")
      .then((me) => router.replace(me.landing))
      .catch(() => router.replace("/login"));
  }, [router]);
  return <Spinner label="Opening Samanvay…" />;
}
