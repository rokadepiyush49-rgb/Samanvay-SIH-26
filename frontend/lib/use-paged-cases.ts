"use client";

import { useEffect, useState } from "react";
import { qs, useApi } from "./api";
import type { CaseList } from "./types";

type Params = Record<string, string | number | boolean | null | undefined>;

function load(key: string): (string | null)[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return Array.isArray(v) && v.length > 0 ? v : [null];
  } catch {
    return [null];
  }
}

/**
 * Server-side paging over /cases. The API pages by cursor (keyset for "received", offset for "due"), so we keep the
 * cursor of every visited page. The stack is kept per query in sessionStorage, so returning to a list restores the
 * page the officer left; it is cleared on sign-out with the rest of the "smv:" keys.
 */
export function usePagedCases(params: Params, pageSize = 25) {
  const base = qs({ ...params, limit: pageSize });
  const storeKey = `smv:pages:${base}`;
  const [stack, setStack] = useState<(string | null)[]>(() => (typeof window === "undefined" ? [null] : load(storeKey)));
  const cursor = stack[stack.length - 1];
  const swr = useApi<CaseList>(`/cases${qs({ ...params, limit: pageSize, cursor })}`, { keepPreviousData: true });

  useEffect(() => {
    try {
      sessionStorage.setItem(storeKey, JSON.stringify(stack));
    } catch {
      /* storage unavailable */
    }
  }, [stack, storeKey]);

  return {
    ...swr,
    page: stack.length,
    pageSize,
    hasNext: !!swr.data?.next_cursor,
    next: () => swr.data?.next_cursor && setStack((s) => [...s, swr.data!.next_cursor]),
    prev: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    reset: () => setStack([null]),
  };
}
