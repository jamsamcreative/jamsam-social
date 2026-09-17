import { describe, it, expect } from "vitest";
import { htmlToText, normaliseUrl, extractInternalLinks, sha1 } from "./html";

const ORIGIN = "https://acme.com";

describe("htmlToText", () => {
  it("strips tags, Gutenberg comments, scripts and styles, decodes entities, collapses whitespace", () => {
    const html = `<!-- wp:paragraph --><p>Pole barns &amp; shops &#8211; built <strong>right</strong>.</p><!-- /wp:paragraph --><script>x()</script><style>p{}</style>\n<h2>Sizes</h2><ul><li>30x40</li><li>40x60</li></ul>`;
    expect(htmlToText(html)).toBe("Pole barns & shops - built right. Sizes 30x40 40x60");
  });
  it("keeps sentence boundaries between blocks", () => {
    expect(htmlToText("<p>One.</p><p>Two.</p>")).toBe("One. Two.");
  });
});

describe("normaliseUrl", () => {
  it("resolves absolute, root-relative and protocol-relative internal links", () => {
    expect(normaliseUrl("https://acme.com/horse-barns/", ORIGIN)).toBe("https://acme.com/horse-barns");
    expect(normaliseUrl("/horse-barns/?utm=1#sizes", ORIGIN)).toBe("https://acme.com/horse-barns");
    expect(normaliseUrl("//acme.com/kits", ORIGIN)).toBe("https://acme.com/kits");
    expect(normaliseUrl("http://www.acme.com/kits/", ORIGIN)).toBe("https://acme.com/kits");
  });
  it("accepts any of several allowed hosts and canonicalises onto the first", () => {
    const origins = ["https://acme.com", "https://acme.wpenginepowered.com"];
    expect(normaliseUrl("https://acme.wpenginepowered.com/horse-barns/", origins)).toBe("https://acme.com/horse-barns");
    expect(normaliseUrl("https://acme.com/kits", origins)).toBe("https://acme.com/kits");
    expect(normaliseUrl("/kits", origins)).toBe("https://acme.com/kits");
    expect(normaliseUrl("https://other.com/kits", origins)).toBeNull();
  });
  it("rejects external, mailto, tel, fragment-only and media links", () => {
    for (const h of ["https://other.com/x", "mailto:a@b.c", "tel:123", "#top", "/wp-content/uploads/a.jpg", "/files/spec.pdf"]) expect(normaliseUrl(h, ORIGIN)).toBeNull();
  });
});

describe("extractInternalLinks", () => {
  it("resolves anchors written with an alternate host", () => {
    const html = `<a href="https://acme.wpenginepowered.com/kits/">kits</a>`;
    expect(extractInternalLinks(html, [ORIGIN, "https://acme.wpenginepowered.com"])).toEqual([{ href: "https://acme.com/kits", anchorText: "kits" }]);
  });

  it("returns internal anchors with their text, in order, skipping external ones", () => {
    const html = `<p>See <a href="/horse-barns/">horse barns</a> and <a href="https://other.com">this</a>, or <a class="x" href='https://acme.com/kits#a'><em>kits</em></a>.</p>`;
    expect(extractInternalLinks(html, ORIGIN)).toEqual([
      { href: "https://acme.com/horse-barns", anchorText: "horse barns" },
      { href: "https://acme.com/kits", anchorText: "kits" },
    ]);
  });
});

describe("sha1", () => {
  it("is stable", () => { expect(sha1("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d"); });
});
