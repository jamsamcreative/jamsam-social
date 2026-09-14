import { fetchWithTimeout } from "@/lib/connections/http";

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public reason?: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export type GoogleDeps = { token: string; fetchImpl?: typeof fetch };

/** JSON call to a Google API; surfaces Google's error message + reason. */
export async function googleJson<T>(url: string, deps: GoogleDeps, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithTimeout(url, { ...init, headers: { Authorization: `Bearer ${deps.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } }, 30_000, deps.fetchImpl ?? fetch);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const e = (body as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } } | null)?.error;
    throw new GoogleApiError(e?.message ?? `Google responded ${res.status}`, res.status, e?.status ?? e?.errors?.[0]?.reason);
  }
  return body as T;
}
