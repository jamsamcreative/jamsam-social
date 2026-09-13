import { describe, it, expect, vi } from "vitest";
import { publishToInstagram } from "@/lib/publishers/instagram";

function mockGraph(handlers: Record<string, (body: URLSearchParams, url: URL) => unknown>) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const path = u.pathname.replace("/v21.0", "");
    const body = new URLSearchParams((init?.body as string) ?? "");
    const h = handlers[path];
    if (!h) return new Response(JSON.stringify({ error: { message: `no handler ${path}` } }), { status: 400 });
    return new Response(JSON.stringify(h(body, u)), { status: 200 });
  }) as unknown as typeof fetch;
}
const noSleep = async () => {};

describe("publishToInstagram", () => {
  it("rejects without media", async () => {
    await expect(publishToInstagram("ig", "t", { caption: "c", link_url: null, media: [] }, { fetchImpl: mockGraph({}), sleep: noSleep })).rejects.toThrow(/image/i);
  });
  it("single image: container, wait FINISHED, publish, permalink", async () => {
    const f = mockGraph({
      "/ig/media": (b) => {
        expect(b.get("image_url")).toBe("https://img/1.jpg");
        expect(b.get("caption")).toBe("c");
        return { id: "c1" };
      },
      "/c1": () => ({ status_code: "FINISHED" }),
      "/ig/media_publish": (b) => {
        expect(b.get("creation_id")).toBe("c1");
        return { id: "m1" };
      },
      "/m1": () => ({ permalink: "https://instagram.com/p/abc" }),
    });
    expect(await publishToInstagram("ig", "t", { caption: "c", link_url: null, media: [{ url: "https://img/1.jpg" }] }, { fetchImpl: f, sleep: noSleep })).toEqual({ external_id: "m1", external_url: "https://instagram.com/p/abc" });
  });
  it("carousel: children then parent", async () => {
    let n = 0;
    const f = mockGraph({
      "/ig/media": (b) => {
        if (b.get("is_carousel_item") === "true") return { id: `ch${++n}` };
        expect(b.get("media_type")).toBe("CAROUSEL");
        expect(b.get("children")).toBe('["ch1","ch2"]');
        return { id: "parent" };
      },
      "/ch1": () => ({ status_code: "FINISHED" }),
      "/ch2": () => ({ status_code: "FINISHED" }),
      "/parent": () => ({ status_code: "FINISHED" }),
      "/ig/media_publish": () => ({ id: "m2" }),
      "/m2": () => ({ permalink: "https://instagram.com/p/def" }),
    });
    expect(await publishToInstagram("ig", "t", { caption: "c", link_url: null, media: [{ url: "a" }, { url: "b" }] }, { fetchImpl: f, sleep: noSleep })).toEqual({ external_id: "m2", external_url: "https://instagram.com/p/def" });
  });
  it("fails when the container errors", async () => {
    const f = mockGraph({ "/ig/media": () => ({ id: "c1" }), "/c1": () => ({ status_code: "ERROR", status: "Media too large" }) });
    await expect(publishToInstagram("ig", "t", { caption: "c", link_url: null, media: [{ url: "a" }] }, { fetchImpl: f, sleep: noSleep })).rejects.toThrow(/Media too large/);
  });
});
