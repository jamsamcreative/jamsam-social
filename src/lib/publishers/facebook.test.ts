import { describe, it, expect, vi } from "vitest";
import { publishToFacebook } from "@/lib/publishers/facebook";

function mockGraph(handlers: Record<string, (body: URLSearchParams) => unknown>) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace("/v21.0", "");
    const body = new URLSearchParams((init?.body as string) ?? "");
    const h = handlers[path];
    if (!h) return new Response(JSON.stringify({ error: { message: `no handler ${path}` } }), { status: 400 });
    return new Response(JSON.stringify(h(body)), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("publishToFacebook", () => {
  it("text/link post uses /feed", async () => {
    const f = mockGraph({
      "/p1/feed": (b) => {
        expect(b.get("message")).toBe("hi");
        expect(b.get("link")).toBe("https://x");
        return { id: "p1_9" };
      },
    });
    expect(await publishToFacebook("p1", "t", { caption: "hi", link_url: "https://x", media: [] }, f)).toEqual({ external_id: "p1_9", external_url: "https://www.facebook.com/p1_9" });
  });
  it("single photo uses /photos", async () => {
    const f = mockGraph({
      "/p1/photos": (b) => {
        expect(b.get("url")).toBe("https://img/1.jpg");
        expect(b.get("message")).toBe("hi");
        return { id: "ph", post_id: "p1_10" };
      },
    });
    expect(await publishToFacebook("p1", "t", { caption: "hi", link_url: null, media: [{ url: "https://img/1.jpg" }] }, f)).toEqual({ external_id: "p1_10", external_url: "https://www.facebook.com/p1_10" });
  });
  it("multi photo uploads unpublished then attaches", async () => {
    let n = 0;
    const f = mockGraph({
      "/p1/photos": (b) => {
        expect(b.get("published")).toBe("false");
        return { id: `ph${++n}` };
      },
      "/p1/feed": (b) => {
        expect(b.get("attached_media")).toBe('[{"media_fbid":"ph1"},{"media_fbid":"ph2"}]');
        return { id: "p1_11" };
      },
    });
    expect(await publishToFacebook("p1", "t", { caption: "hi", link_url: null, media: [{ url: "a" }, { url: "b" }] }, f)).toEqual({ external_id: "p1_11", external_url: "https://www.facebook.com/p1_11" });
  });
});
