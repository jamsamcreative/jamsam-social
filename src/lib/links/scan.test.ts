import { describe, it, expect, vi } from "vitest";
import { scanBrand, type ScanMirror } from "./scan";
import { BRAND, fakeLinksStore, page } from "./fake-store";

// Three posts: A links to B; C is standalone. B's body mentions C's title, so C gets a pending
// suggestion hosted by B; nothing mentions A's title, so A gets a `none` verdict.
const seed = () =>
  fakeLinksStore({
    pages: [
      page("a", { title: "Alpha Post", content_text: "Alpha links to beta." }),
      page("b", { title: "Beta Post", content_text: "Our horse barns are sturdy. Beta is here." }),
      page("c", { title: "Horse Barns", content_text: "All about barns." }),
    ],
  });

const mirrored = (store: ReturnType<typeof seed>) =>
  store.pages.map((p) => ({ wp_id: p.wp_id, type: p.type, url: p.url, content_html: p.id === "a" ? `<p><a href="https://acme.com/b">B</a></p>` : "<p>plain</p>" }));

describe("scanBrand", () => {
  it("mirrors, rebuilds the graph, proposes links, upserts outcomes and logs the scan", async () => {
    const store = seed();
    const mirror: ScanMirror = vi.fn(async () => ({ pages: 3, mirrored: mirrored(store) }));
    const logScan = vi.spyOn(store, "logScan");

    const out = await scanBrand(store, { brandId: BRAND.id, userId: "u1", mirror });

    expect(mirror).toHaveBeenCalledWith(BRAND.id);
    expect(out).toEqual({ pages: 3, links: 1, orphans: 2, suggested: 1, none: 1 });
    expect(await store.listEdges(BRAND.id)).toEqual([{ from_page_id: "a", to_page_id: "b", href: "https://acme.com/b", anchor_text: "B" }]);
    const rows = await store.listSuggestions(BRAND.id);
    expect(rows.map((r) => [r.orphan_page_id, r.status, r.host_page_id, r.phrase])).toEqual([
      ["a", "none", null, null],
      ["c", "pending", "b", "horse barns"],
    ]);
    expect(rows[0].reason).toBe("no other post mentions the topic");
    expect(rows[0].phrases_tried).toEqual(["alpha post"]);
    expect(rows[1].context).toBe("Our horse barns are sturdy.");
    expect(logScan).toHaveBeenCalledWith(BRAND.id, "3 pages, 1 links, 2 orphans", 2, "u1");
    expect(store.imports).toHaveLength(1);
  });

  it("replaces stale edges from a previous scan", async () => {
    const store = seed();
    await store.addEdge(BRAND.id, { from_page_id: "c", to_page_id: "a", href: "https://acme.com/a", anchor_text: "old" });
    await scanBrand(store, { brandId: BRAND.id, userId: null, mirror: async () => ({ pages: 3, mirrored: mirrored(store) }) });
    expect((await store.listEdges(BRAND.id)).map((e) => e.from_page_id + ">" + e.to_page_id)).toEqual(["a>b"]);
  });

  it("falls back to the first mirrored page's origin when the brand has no website_url", async () => {
    const store = fakeLinksStore({ pages: seed().pages, brands: [{ ...BRAND, website_url: null }] });
    const out = await scanBrand(store, { brandId: BRAND.id, userId: null, mirror: async () => ({ pages: 3, mirrored: mirrored(store) }) });
    expect(out).toMatchObject({ links: 1, orphans: 2 });
  });

  it("returns the mirror error and leaves the graph and log untouched", async () => {
    const store = seed();
    await store.addEdge(BRAND.id, { from_page_id: "c", to_page_id: "a", href: "https://acme.com/a", anchor_text: "old" });
    const replaceEdges = vi.spyOn(store, "replaceEdges");
    const out = await scanBrand(store, { brandId: BRAND.id, userId: "u1", mirror: async () => ({ error: "WordPress is not connected" }) });
    expect(out).toEqual({ error: "WordPress is not connected" });
    expect(replaceEdges).not.toHaveBeenCalled();
    expect(await store.listEdges(BRAND.id)).toHaveLength(1);
    expect(store.suggestions).toEqual([]);
    expect(store.imports).toEqual([]);
  });
});
