export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  ms = 10_000,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") throw new Error(`Request timed out after ${ms / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalise any thrown value into a TestResult error string.
 * Node's fetch throws a bare "fetch failed" and hides the real reason (ECONNRESET, ENOTFOUND,
 * CERT_HAS_EXPIRED…) in `cause`, so surface that too.
 */
export function errorMessage(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause as { code?: string; message?: string } | undefined;
  if (!cause) return e.message;
  const detail = [cause.code, cause.message].filter(Boolean).join(": ");
  return detail ? `${e.message} (${detail})` : e.message;
}
