import { describe, it, expect } from "vitest";
import { buildEdges, findOrphans } from "./graph";
import type { PageLite } from "./types";

const ORIGIN = "https://acme.com";
const pg = (id: string, slug: string, o: Partial<PageLite & { content_html: string }> = {}): PageLite & { content_html: string } => ({ id, wp_id: 0, type: "post", slug, url: `https://acme.com/${slug}/`, title: slug, focus_keyword: null, content_text: "", modified_at: null, content_html: "", ...o });

describe("buildEdges", () => {
  it("resolves by normalised url, then by slug, and drops self links and unknown targets", () => {
    const pages = [
      pg("a", "horse-barns", { content_html: `<a href="/pole-barns/">pole</a> <a href="https://acme.com/horse-barns">me</a> <a href="/nope/">x</a> <a href="https://www.acme.com/kits?x=1#y">kits</a>` }),
      pg("b", "pole-barns"), pg("c", "kits", { url: "https://acme.com/blog/kits/" }),
    ];
    expect(buildEdges(pages, ORIGIN)).toEqual([
      { from_page_id: "a", to_page_id: "b", href: "https://acme.com/pole-barns", anchor_text: "pole" },
      { from_page_id: "a", to_page_id: "c", href: "https://acme.com/kits", anchor_text: "kits" },
    ]);
  });
});

describe("buildEdges with several site hosts", () => {
  it("resolves a body link written with the alternate host to the page's canonical url", () => {
    const pages = [
      pg("a", "horse-barns", { content_html: `<a href="https://acme.wpenginepowered.com/pole-barns/">pole</a>` }),
      pg("b", "pole-barns"),
    ];
    expect(buildEdges(pages, [ORIGIN, "https://acme.wpenginepowered.com"])).toEqual([
      { from_page_id: "a", to_page_id: "b", href: "https://acme.com/pole-barns", anchor_text: "pole" },
    ]);
  });
  it("still accepts a single origin string", () => {
    const pages = [pg("a", "horse-barns", { content_html: `<a href="/pole-barns/">pole</a>` }), pg("b", "pole-barns")];
    expect(buildEdges(pages, ORIGIN)).toHaveLength(1);
  });
});

describe("findOrphans", () => {
  it("returns pages with no inbound edge from a different page, utility pages last", () => {
    const pages = [pg("a", "horse-barns"), pg("b", "pole-barns"), pg("p", "privacy-policy", { type: "page" }), pg("h", "kits")];
    const edges = [{ from_page_id: "a", to_page_id: "b", href: "", anchor_text: "" }, { from_page_id: "h", to_page_id: "h", href: "", anchor_text: "" }];
    expect(findOrphans(pages, edges).map((o) => [o.page.id, o.utility])).toEqual([["a", false], ["h", false], ["p", true]]);
  });
});
