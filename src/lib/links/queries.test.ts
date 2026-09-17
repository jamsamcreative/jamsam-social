import { describe, it, expect, vi } from "vitest";
import { getLinksPageData } from "./queries";
import { BRAND, fakeLinksStore, page } from "./fake-store";

const seed = () => {
  const store = fakeLinksStore({
    pages: [
      page("b", { title: "Beta Post", content_text: "Our horse barns are sturdy." }),
      page("c", { title: "Horse Barns", content_text: "All about barns." }),
      page("p", { type: "page", slug: "privacy-policy", title: "Privacy", content_text: "" }),
    ],
  });
  const now = new Date().toISOString();
  const row = (id: string, over: Partial<(typeof store.suggestions)[number]>) => ({
    id, brand_id: BRAND.id, orphan_page_id: "c", host_page_id: "b", phrase: "horse barns", context: "Our horse barns are sturdy.",
    status: "pending" as const, reason: null, phrases_tried: [], href: null, undo_snippet: null, applied_at: null, applied_by: null, created_at: now, updated_at: now, ...over,
  });
  store.suggestions.push(row("s1", {}), row("s2", { orphan_page_id: "p", host_page_id: null, phrase: null, status: "none", reason: "no other post mentions the topic", phrases_tried: ["privacy"] }));
  return store;
};

describe("getLinksPageData", () => {
  it("builds cards from page metadata only — it never loads every page's content_text", async () => {
    const store = seed();
    const listPages = vi.spyOn(store, "listPages");
    const listPageMeta = vi.spyOn(store, "listPageMeta");

    const data = await getLinksPageData(BRAND.slug, store);

    expect(listPages).not.toHaveBeenCalled();
    expect(listPageMeta).toHaveBeenCalledWith(BRAND.id);
    expect(data.pending.map((c) => [c.orphanTitle, c.hostTitle, c.phrase])).toEqual([["Horse Barns", "Beta Post", "horse barns"]]);
    expect(data.none.map((c) => [c.orphanTitle, c.utility])).toEqual([["Privacy", true]]);
    expect(data.stats).toEqual({ pages: 3, pending: 1, added: 0 });
  });
});
