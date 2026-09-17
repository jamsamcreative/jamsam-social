import { describe, it, expect } from "vitest";
import { candidatePhrases, siteWideTerms, suggestFor, contextFor, phraseRegex } from "./suggest";
import type { PageLite } from "./types";

const pg = (id: string, title: string, o: Partial<PageLite> = {}): PageLite => ({ id, wp_id: 0, type: "post", slug: id, url: `https://acme.com/${id}/`, title, focus_keyword: null, content_text: "", modified_at: null, ...o });

describe("candidatePhrases", () => {
  it("orders focus keyword, title, title without subtitle, then n-grams; no stop-word-only phrases or duplicates", () => {
    const p = pg("x", "Metal Roof Vents: Ridge, Static, and Turbine Options Compared", { focus_keyword: "metal roof vents" });
    const out = candidatePhrases(p);
    expect(out[0]).toBe("metal roof vents");
    expect(out[1]).toBe("metal roof vents: ridge, static, and turbine options compared");
    expect(out).toContain("turbine options");
    expect(out).toContain("ridge static");
    expect(out).not.toContain("and turbine");
    expect(out).not.toContain("static and");
    expect(out).not.toContain("ridge static and");
    expect(out).not.toContain("static turbine");
    expect(out).not.toContain("ridge static turbine");
    expect(new Set(out).size).toBe(out.length);
    expect(out.every((s) => s.trim().split(/\s+/).length >= 2)).toBe(true);
  });
  it("allows a single-word focus keyword", () => {
    expect(candidatePhrases(pg("y", "Barndominiums", { focus_keyword: "barndominiums" }))[0]).toBe("barndominiums");
  });
});

describe("phraseRegex / contextFor", () => {
  it("matches whole words case-insensitively and returns the containing sentence", () => {
    expect(phraseRegex("pole barn").test("A Pole Barn is cheap.")).toBe(true);
    expect(phraseRegex("pole barn").test("Tadpole barnacle")).toBe(false);
    expect(contextFor("Intro here. Our pole barn kits ship fast. Later text.", "pole barn")).toBe("Our pole barn kits ship fast.");
    expect(contextFor("Need kits? Our pole barn kits ship fast! Later.", "pole barn kits")).toBe("Our pole barn kits ship fast!");
  });
});

describe("siteWideTerms", () => {
  it("flags phrases present in more than 40% of posts when there are at least 5 posts", () => {
    const posts = Array.from({ length: 6 }, (_, i) => pg(`p${i}`, `t${i}`, { content_text: i < 4 ? "we build metal buildings here" : "other text" }));
    expect(siteWideTerms(["metal buildings", "other text"], posts)).toEqual(new Set(["metal buildings"]));
    expect(siteWideTerms(["metal buildings"], posts.slice(0, 4))).toEqual(new Set());
  });
});

describe("suggestFor", () => {
  const orphan = pg("o", "Pole Barn Kits: Prices and Sizes", { focus_keyword: "pole barn kits" });
  const posts = [
    orphan,
    pg("h1", "Shop Builds in Spokane", { content_text: "Most customers start with pole barn kits and add a lean-to.", modified_at: "2026-01-01T00:00:00Z" }),
    pg("h2", "Pole Barn Kits FAQ", { content_text: "Our pole barn kits ship in 3 weeks.", modified_at: "2025-01-01T00:00:00Z" }),
    pg("linker", "Already links", { content_text: "pole barn kits are great" }),
    pg("page1", "Service page", { type: "page", content_text: "pole barn kits pole barn kits" }),
  ];
  const edges = [{ from_page_id: "linker", to_page_id: "o", href: "", anchor_text: "" }];
  it("picks the longest matching phrase and the host with most title overlap, skipping the orphan, existing linkers and pages", () => {
    const s = suggestFor(orphan, posts, edges, new Set());
    expect(s).toEqual({ orphan_page_id: "o", host_page_id: "h2", phrase: "pole barn kits", context: "Our pole barn kits ship in 3 weeks." });
  });
  it("never re-proposes a rejected host+phrase", () => {
    const s = suggestFor(orphan, posts, edges, new Set(["h2|pole barn kits"]));
    expect(s).toMatchObject({ host_page_id: "h1" });
  });
  it("returns a none verdict with the right reason and phrases tried", () => {
    const lonely = pg("z", "Something Unique Entirely", { focus_keyword: "something unique" });
    expect(suggestFor(lonely, [lonely, ...posts.slice(1)], [], new Set())).toEqual({ orphan_page_id: "z", reason: "no other post mentions the topic", phrases_tried: expect.arrayContaining(["something unique"]) });
    const onlySelf = pg("s", "Self Only Topic", { content_text: "self only topic here" });
    expect(suggestFor(onlySelf, [onlySelf, pg("q", "Q", { content_text: "self only topic" })], [{ from_page_id: "q", to_page_id: "s", href: "", anchor_text: "" }], new Set())).toMatchObject({ reason: "only inside itself or in posts that already link here" });
    const wide = pg("w", "Metal Buildings Guide", { focus_keyword: "metal buildings" });
    const many = Array.from({ length: 6 }, (_, i) => pg(`m${i}`, `m${i}`, { content_text: "metal buildings everywhere" }));
    expect(suggestFor(wide, [wide, ...many], [], new Set())).toMatchObject({ reason: "site-wide term" });
  });
});
