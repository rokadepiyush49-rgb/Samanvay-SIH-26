"use client";

import useSWR, { type SWRConfiguration } from "swr";

/** RFC 9457 problem returned by the API. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public title: string,
    public detail: string,
    public body: Record<string, unknown>,
  ) {
    super(detail || title);
  }
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)smv_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export async function ensureCsrf(): Promise<void> {
  if (!csrfToken()) await fetch("/api/v1/auth/csrf", { credentials: "same-origin" });
}

type Options = { method?: string; json?: unknown; form?: FormData; headers?: Record<string, string> };

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? (opts.json !== undefined || opts.form ? "POST" : "GET");
  if (method !== "GET") await ensureCsrf();
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (method !== "GET") headers["x-csrf-token"] = csrfToken();
  if (opts.json !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
  });
  if (res.status === 401 && !path.startsWith("/auth/") && typeof window !== "undefined") {
    // Outside React (no router here): a full navigation also drops any stale client state.
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(new URL(`/login?next=${next}`, window.location.origin).toString());
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    const body = (data ?? {}) as Record<string, unknown>;
    throw new ApiError(res.status, String(body.title ?? res.statusText), String(body.detail ?? ""), body);
  }
  return data as T;
}

export function useApi<T>(path: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(path, (p: string) => api<T>(p), { revalidateOnFocus: true, ...config });
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
