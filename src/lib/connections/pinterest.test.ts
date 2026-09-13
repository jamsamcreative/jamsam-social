import { describe, it, expect, vi } from "vitest";
import { pinterest } from "@/lib/connections/pinterest";

describe("pinterest.test", () => {
  it("succeeds with the account username", async () => {
    const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.pinterest.com/v5/user_account");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return new Response(JSON.stringify({ username: "acmebuilds", account_type: "BUSINESS" }), { status: 200 });
    });
    const r = await pinterest.test({}, { access_token: "tok" }, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, detail: "Connected as @acmebuilds (BUSINESS)" });
  });
  it("fails on 401", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ message: "Authentication failed." }), { status: 401 }));
    const r = await pinterest.test({}, { access_token: "bad" }, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, error: "Pinterest responded 401: Authentication failed." });
  });
});
