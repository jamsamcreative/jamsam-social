import { describe, it, expect, vi } from "vitest";
import { createWpClient, listTerms, uploadMediaFromUrl, createPost, checkHelper, WpError } from "@/lib/wordpress/client";

const cfg = { site_url: "https://client.com/", username: "u" };
const sec = { app_password: "p" };
const mock = (h: (u: URL, init?: RequestInit) => Response | Promise<Response>) =>
  vi.fn((u: RequestInfo | URL, init?: RequestInit) => h(new URL(String(u)), init)) as unknown as typeof fetch;

describe("wp client", () => {
  it("lists terms across pages", async () => {
    const f = mock((u) => {
      const page = u.searchParams.get("page");
      const body = page === "1" ? [{ id: 1, name: "News" }] : [{ id: 2, name: "Tips" }];
      return new Response(JSON.stringify(body), { status: 200, headers: { "X-WP-TotalPages": "2" } });
    });
    expect(await listTerms(createWpClient(cfg, sec, f), "categories")).toEqual([
      { id: 1, name: "News" },
      { id: 2, name: "Tips" },
    ]);
  });
  it("uploads media from a url and sets alt text", async () => {
    const calls: string[] = [];
    const f = mock(async (u, init) => {
      calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
      if (u.hostname === "img.example") return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
      if (u.pathname.endsWith("/wp/v2/media") && init?.method === "POST") {
        expect((init.headers as Record<string, string>)["Content-Disposition"]).toBe('attachment; filename="shop.jpg"');
        return new Response(JSON.stringify({ id: 55, source_url: "https://client.com/wp-content/uploads/shop.jpg" }), { status: 201 });
      }
      if (u.pathname.endsWith("/wp/v2/media/55")) return new Response(JSON.stringify({ id: 55 }), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    const r = await uploadMediaFromUrl(createWpClient(cfg, sec, f), "https://img.example/shop.jpg", { alt: "A shop", fetchImpl: f });
    expect(r).toEqual({ id: 55, source_url: "https://client.com/wp-content/uploads/shop.jpg" });
    expect(calls).toContain("POST /wp-json/wp/v2/media/55");
  });
  it("throws WpError with the WP message", async () => {
    const f = mock(() => new Response(JSON.stringify({ code: "rest_cannot_create", message: "Sorry, you are not allowed" }), { status: 401 }));
    await expect(createPost(createWpClient(cfg, sec, f), { title: "t", slug: "t", content: "", status: "draft" })).rejects.toBeInstanceOf(WpError);
    await expect(createPost(createWpClient(cfg, sec, f), { title: "t", slug: "t", content: "", status: "draft" })).rejects.toThrow(/not allowed/);
  });
  it("detects the helper plugin", async () => {
    const f = mock((u) => {
      const ping = u.pathname.endsWith("/jamsam/v1/ping");
      // Hosts like WP Engine cache the 404 from before the plugin was installed; the ping must cache-bust.
      if (ping) expect(u.searchParams.get("_")).toMatch(/^\d+$/);
      return new Response(ping ? JSON.stringify({ ok: true, version: "1.0.0" }) : "{}", { status: ping ? 200 : 404 });
    });
    expect(await checkHelper(createWpClient(cfg, sec, f))).toEqual({ installed: true, version: "1.0.0" });
    const g = mock(() => new Response(JSON.stringify({ code: "rest_no_route" }), { status: 404 }));
    expect(await checkHelper(createWpClient(cfg, sec, g))).toEqual({ installed: false });
  });
});
