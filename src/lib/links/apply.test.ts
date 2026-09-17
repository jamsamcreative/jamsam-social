import { describe, it, expect } from "vitest";
import { wrapPhrase, unwrapSnippet } from "./apply";

const HREF = "https://acme.com/pole-barn-kits/";

describe("wrapPhrase", () => {
  it("wraps the first whole-word occurrence outside anchors, headings, code and block comments, keeping original casing", () => {
    const html = `<!-- wp:heading --><h2>Pole Barn Kits</h2><!-- /wp:heading --><!-- wp:paragraph --><p>Already <a href="/x">pole barn kits</a> linked. Our Pole barn kits ship fast, and pole barn kits again.</p><!-- /wp:paragraph --><pre>pole barn kits</pre>`;
    const r = wrapPhrase(html, "pole barn kits", HREF)!;
    expect(r.snippet).toBe(`<a href="${HREF}">Pole barn kits</a>`);
    expect(r.html).toBe(`<!-- wp:heading --><h2>Pole Barn Kits</h2><!-- /wp:heading --><!-- wp:paragraph --><p>Already <a href="/x">pole barn kits</a> linked. Our <a href="${HREF}">Pole barn kits</a> ship fast, and pole barn kits again.</p><!-- /wp:paragraph --><pre>pole barn kits</pre>`);
  });
  it("returns null when the phrase is absent or only inside tags/anchors", () => {
    expect(wrapPhrase(`<p><a href="/x">pole barn kits</a></p>`, "pole barn kits", HREF)).toBeNull();
    expect(wrapPhrase(`<p data-x="pole barn kits">nothing</p>`, "pole barn kits", HREF)).toBeNull();
  });
  it("is idempotent when the snippet already exists", () => {
    const once = wrapPhrase(`<p>Our pole barn kits ship.</p>`, "pole barn kits", HREF)!;
    expect(wrapPhrase(once.html, "pole barn kits", HREF)).toEqual({ html: once.html, snippet: once.snippet });
  });
  it("matches across whitespace variants but keeps the original text", () => {
    const r = wrapPhrase(`<p>pole  barn\nkits here</p>`, "pole barn kits", HREF)!;
    expect(r.html).toBe(`<p><a href="${HREF}">pole  barn\nkits</a> here</p>`);
  });
});

describe("unwrapSnippet", () => {
  it("removes exactly that anchor and returns null if it is gone", () => {
    const html = `<p>Our <a href="${HREF}">Pole barn kits</a> ship.</p>`;
    expect(unwrapSnippet(html, `<a href="${HREF}">Pole barn kits</a>`)).toBe(`<p>Our Pole barn kits ship.</p>`);
    expect(unwrapSnippet(`<p>edited</p>`, `<a href="${HREF}">Pole barn kits</a>`)).toBeNull();
  });
});
