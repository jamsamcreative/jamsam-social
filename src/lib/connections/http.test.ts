import { describe, it, expect, vi } from "vitest";
import { fetchWithTimeout } from "@/lib/connections/http";

describe("fetchWithTimeout", () => {
  it("passes through a fast response", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    const res = await fetchWithTimeout("https://x", {}, 1000, f as unknown as typeof fetch);
    expect(res.status).toBe(200);
  });
  it("rejects with a timeout message when the request hangs", async () => {
    const f = vi.fn(
      (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    await expect(fetchWithTimeout("https://x", {}, 20, f as unknown as typeof fetch)).rejects.toThrow(/timed out/i);
  });
});
