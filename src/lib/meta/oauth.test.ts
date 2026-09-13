import { describe, it, expect, vi } from "vitest";
import { signState, verifyState, buildAuthUrl, exchangeCode, listPages } from "@/lib/meta/oauth";

describe("oauth state", () => {
  it("round-trips and rejects tampering", () => {
    const s = signState({ brand: "acme", nonce: "n1" });
    expect(verifyState(s)).toEqual({ brand: "acme", nonce: "n1" });
    expect(verifyState(s.slice(0, -2) + "zz")).toBeNull();
    expect(verifyState("garbage")).toBeNull();
  });
});

describe("buildAuthUrl", () => {
  it("includes client id, redirect, scopes, state", () => {
    const u = new URL(buildAuthUrl({ redirectUri: "https://app/cb", state: "st" }));
    expect(u.origin + u.pathname).toBe("https://www.facebook.com/v21.0/dialog/oauth");
    expect(u.searchParams.get("client_id")).toBe("123");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app/cb");
    expect(u.searchParams.get("scope")).toContain("pages_manage_posts");
    expect(u.searchParams.get("state")).toBe("st");
  });
});

describe("exchangeCode", () => {
  it("exchanges code then upgrades to a long-lived token", async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      calls.push(u.searchParams.get("grant_type") ?? "code");
      return new Response(JSON.stringify({ access_token: calls.length === 1 ? "short" : "long" }), { status: 200 });
    });
    expect(await exchangeCode({ code: "c", redirectUri: "https://app/cb", fetchImpl: f as unknown as typeof fetch })).toBe("long");
    expect(calls).toEqual(["code", "fb_exchange_token"]);
  });
});

describe("listPages", () => {
  it("maps pages with instagram accounts", async () => {
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "1", name: "A", access_token: "ta", instagram_business_account: { id: "i1", username: "a_ig" } },
              { id: "2", name: "B", access_token: "tb" },
            ],
          }),
          { status: 200 },
        ),
    );
    expect(await listPages("u", f as unknown as typeof fetch)).toEqual([
      { id: "1", name: "A", access_token: "ta", ig_user_id: "i1", ig_username: "a_ig" },
      { id: "2", name: "B", access_token: "tb", ig_user_id: undefined, ig_username: undefined },
    ]);
  });
});
