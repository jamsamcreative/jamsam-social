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

/** Normalise any thrown value into a TestResult error string. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
