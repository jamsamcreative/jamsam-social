import { describe, it, expect } from "vitest";
import { pinterestAuthUrl, exchangeCode, refreshAccessToken, needsRefresh, listBoards, createPin, pinAnalytics, PinterestError } from "@/lib/pinterest/client";

const mock = (h: (u: URL, init?: RequestInit) => Response): typeof fetch => (async (i, init) => h(new URL(String(i)), init)) as typeof fetch;

describe("pinterest client", () => {
  it("builds the auth url with scopes", () => {
    const u = new URL(pinterestAuthUrl({ appId: "1", redirectUri: "https://x/cb", state: "s" }));
    expect(u.searchParams.get("scope")).toBe("boards:read,boards:write,pins:read,pins:write,user_accounts:read");
    expect(u.searchParams.get("client_id")).toBe("1");
  });
  it("exchanges and refreshes tokens with Basic auth and computes expiry", async () => {
    const f = mock((u, init) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("1:sec").toString("base64")}`);
      return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 2592000, refresh_token_expires_in: 31536000 }));
    });
    const t = await exchangeCode("1", "sec", "code", "https://x/cb", f);
    expect(t.access_token).toBe("at");
    expect(Date.parse(t.expires_at)).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await refreshAccessToken("1", "sec", "rt", f)).refresh_token).toBe("rt");
    await expect(exchangeCode("1", "sec", "bad", "https://x/cb", mock(() => new Response(JSON.stringify({ message: "invalid_grant" }), { status: 400 })))).rejects.toBeInstanceOf(PinterestError);
  });
  it("needsRefresh inside 3 days", () => {
    const now = Date.parse("2026-09-14T00:00:00Z");
    expect(needsRefresh("2026-09-15T00:00:00Z", now)).toBe(true);
    expect(needsRefresh("2026-09-30T00:00:00Z", now)).toBe(false);
    expect(needsRefresh(undefined, now)).toBe(false);
  });
  it("lists boards across bookmarks, creates a pin, reads analytics", async () => {
    let page = 0;
    const f = mock((u, init) => {
      if (u.pathname.endsWith("/boards")) return new Response(JSON.stringify(page++ === 0 ? { items: [{ id: "b1", name: "Shops", pin_count: 4 }], bookmark: "next" } : { items: [{ id: "b2", name: "Barns" }], bookmark: null }));
      if (u.pathname.endsWith("/pins") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toMatchObject({ board_id: "b1", media_source: { source_type: "image_url", url: "https://cdn/1.jpg" } });
        return new Response(JSON.stringify({ id: "99" }), { status: 201 });
      }
      if (u.pathname.includes("/analytics")) return new Response(JSON.stringify({ all: { lifetime_metrics: { IMPRESSION: 120, SAVE: 3, PIN_CLICK: 8, OUTBOUND_CLICK: 2 } } }));
      return new Response("{}", { status: 404 });
    });
    expect((await listBoards("t", f)).map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(await createPin("t", { board_id: "b1", title: "T", description: "D", media_source: { source_type: "image_url", url: "https://cdn/1.jpg" } }, f)).toEqual({ id: "99", url: "https://www.pinterest.com/pin/99/" });
    expect(await pinAnalytics("t", "99", "2026-09-01", "2026-09-13", f)).toMatchObject({ impressions: 120, saves: 3, pin_clicks: 8, outbound_clicks: 2 });
  });
});
