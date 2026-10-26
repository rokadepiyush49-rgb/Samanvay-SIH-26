"use client";

import type { ReactNode } from "react";
import { can, type Capability } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { PermissionDenied } from "./ui";

/** Page-level permission gate for a clear denied state. The API enforces the same rule and returns 403 regardless. */
export function Require({ cap, children }: { cap: Capability; children: ReactNode }) {
  const { me } = useSession();
  if (!can(me, cap)) return <PermissionDenied />;
  return <>{children}</>;
}
