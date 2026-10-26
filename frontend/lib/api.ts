"use client";

import useSWR, { mutate as globalMutate, type SWRConfiguration } from "swr";

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

/** Thrown when the API cannot be reached at all (offline, proxy down). */
export class NetworkError extends Error {
  constructor() {
    super("The Samanvay server could not be reached. Check your connection and try again.");
  }
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)smv_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export async function ensureCsrf(): Promise<void> {
  if (!csrfToken()) await fetch("/api/v1/auth/csrf", { credentials: "same-origin" }).catch(() => undefined);
}

type Options = { method?: string; json?: unknown; form?: FormData; headers?: Record<string, string> };

let redirecting = false;

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? (opts.json !== undefined || opts.form ? "POST" : "GET");
  if (method !== "GET") await ensureCsrf();
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (method !== "GET") headers["x-csrf-token"] = csrfToken();
  if (opts.json !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
    });
  } catch {
    throw new NetworkError();
  }
  if (res.status === 401 && !path.startsWith("/auth/") && typeof window !== "undefined" && !redirecting) {
    // Session expired or revoked: drop cached private data and send the officer back to sign in, keeping the page.
    redirecting = true;
    clearPrivateCache();
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(new URL(`/login?reason=expired&next=${next}`, window.location.origin).toString());
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const body = (data ?? {}) as Record<string, unknown>;
    throw new ApiError(res.status, String(body.title ?? res.statusText), String(body.detail ?? ""), body);
  }
  return data as T;
}

export function useApi<T>(path: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(path, (p: string) => api<T>(p), { revalidateOnFocus: true, shouldRetryOnError: false, ...config });
}

/** Re-fetches every cached response whose path starts with one of the prefixes (after a write that affects them). */
export function revalidate(...prefixes: string[]): void {
  void globalMutate((k) => typeof k === "string" && prefixes.some((p) => k.startsWith(p)));
}

/** Removes every cached API response and per-tab private state (used on sign-out and session expiry). */
export function clearPrivateCache(): void {
  void globalMutate(() => true, undefined, { revalidate: false });
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith("smv:")) sessionStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== false) sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function errorMessage(e: unknown): { title: string; detail: string } {
  if (e instanceof ApiError) {
    if (e.status === 403) return { title: e.title || "Not permitted", detail: e.detail || "Your role does not allow this." };
    if (e.status === 409) return { title: e.title || "Changed by someone else", detail: e.detail || "Reload the page to see the latest version, then try again." };
    return { title: e.title || "Request failed", detail: e.detail || "Please try again." };
  }
  if (e instanceof NetworkError) return { title: "Connection problem", detail: e.message };
  return { title: "Something went wrong", detail: e instanceof Error ? e.message : "Please try again." };
}
