import { describe, it, expect, vi } from "vitest";
import { fetchWithTimeout, errorMessage } from "@/lib/connections/http";

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

describe("errorMessage", () => {
  it("returns the message for a plain error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
  it("appends the cause code when fetch fails at the network level", () => {
    const e = new Error("fetch failed", { cause: Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" }) });
    expect(errorMessage(e)).toBe("fetch failed (ECONNRESET: connect ECONNRESET)");
  });
  it("falls back to the cause message when it has no code", () => {
    const e = new Error("fetch failed", { cause: new Error("certificate has expired") });
    expect(errorMessage(e)).toBe("fetch failed (certificate has expired)");
  });
  it("stringifies non-Error values", () => {
    expect(errorMessage("nope")).toBe("nope");
  });
});
