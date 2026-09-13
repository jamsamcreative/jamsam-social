import { describe, it, expect, vi } from "vitest";
import { meta } from "@/lib/connections/meta";

const cfg = { page_id: "123" };
const sec = { page_access_token: "EAAB..." };

describe("meta.test", () => {
  it("succeeds and reports page + instagram account", async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      expect(u.origin + u.pathname).toBe("https://graph.facebook.com/v21.0/123");
      expect(u.searchParams.get("access_token")).toBe("EAAB...");
      return new Response(
        JSON.stringify({ name: "Acme Page", instagram_business_account: { id: "999", username: "acme" } }),
        { status: 200 },
      );
    });
    const r = await meta.test(cfg, sec, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, detail: "Page: Acme Page. Instagram: @acme" });
  });
  it("reports missing instagram without failing", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ name: "Acme Page" }), { status: 200 }));
    const r = await meta.test(cfg, sec, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, detail: "Page: Acme Page. Instagram: not linked" });
  });
  it("surfaces Graph API error messages", async () => {
    const f = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 400 }),
    );
    const r = await meta.test(cfg, sec, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, error: "Meta responded 400: Invalid OAuth access token" });
  });
});
