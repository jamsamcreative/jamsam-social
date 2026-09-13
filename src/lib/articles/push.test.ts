import { describe, it, expect, vi } from "vitest";
import {
  finalSeoTitle,
  metaDescriptionWarning,
  extractImageUrls,
  rewriteImageUrls,
  rehostImages,
  buildPostPayload,
  buildPublishPayload,
  validateForPush,
  type ArticleLike,
} from "@/lib/articles/push";

describe("seo helpers", () => {
  it("appends the suffix once", () => {
    expect(finalSeoTitle("Best Shops", "x", " | Acme")).toBe("Best Shops | Acme");
    expect(finalSeoTitle("Best Shops | Acme", "x", " | Acme")).toBe("Best Shops | Acme");
    expect(finalSeoTitle(null, "Fallback", null)).toBe("Fallback");
  });
  it("warns on meta description length", () => {
    expect(metaDescriptionWarning("short")).toMatch(/120/);
    expect(metaDescriptionWarning("x".repeat(140))).toBeNull();
    expect(metaDescriptionWarning("x".repeat(170))).toMatch(/156/);
  });
});

describe("images", () => {
  const html = '<p>a</p><img src="https://cdn.x/1.jpg" alt="one"><img alt="two" src="https://client.com/wp-content/uploads/2.jpg">';
  it("extracts srcs", () => expect(extractImageUrls(html)).toEqual(["https://cdn.x/1.jpg", "https://client.com/wp-content/uploads/2.jpg"]));
  it("rewrites mapped srcs only", () => {
    expect(rewriteImageUrls(html, { "https://cdn.x/1.jpg": "https://client.com/u/1.jpg" })).toContain('src="https://client.com/u/1.jpg"');
    expect(rewriteImageUrls(html, {})).toBe(html);
  });
  it("rehosts external images and the featured image, skipping same-host and cached ones", async () => {
    const upload = vi.fn(async (url: string) => ({ id: url.includes("feat") ? 9 : 7, source_url: url.replace("cdn.x", "client.com/u") }));
    const lookup = vi.fn(async (url: string) => (url.endsWith("cached.jpg") ? { wp_media_id: 3, wp_url: "https://client.com/u/cached.jpg" } : null));
    const r = await rehostImages({
      html: html + '<img src="https://cdn.x/cached.jpg">',
      featured: { url: "https://cdn.x/feat.jpg", alt: "feat" },
      siteHost: "client.com",
      lookup,
      upload,
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(r.featuredId).toBe(9);
    expect(r.html).toContain("https://client.com/u/1.jpg");
    expect(r.html).toContain("https://client.com/u/cached.jpg");
    expect(r.html).toContain("https://client.com/wp-content/uploads/2.jpg");
  });
  it("uploads a url only once even if it is both body and featured", async () => {
    const upload = vi.fn(async () => ({ id: 1, source_url: "https://client.com/u/1.jpg" }));
    const r = await rehostImages({ html: '<img alt="Steel shop" src="https://cdn.x/1.jpg">', featured: { url: "https://cdn.x/1.jpg", alt: "Steel shop" }, siteHost: "client.com", lookup: async () => null, upload });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith("https://cdn.x/1.jpg", "Steel shop");
    expect(r.featuredId).toBe(1);
  });
});

const article: ArticleLike = {
  title: "T",
  slug: "t",
  excerpt: "e",
  seo_title: "S",
  meta_description: "d".repeat(130),
  primary_keyword: "kw",
  categories: [{ id: 1, name: "News" }],
  tags: [{ id: 5, name: "x" }],
  featured_media: { url: "https://cdn.x/f.jpg", alt: "f" },
  content_html: "<p>x</p>",
};

describe("payloads", () => {
  it("builds a draft payload with yoast meta when helper installed", () => {
    const p = buildPostPayload(article, { html: "<p>y</p>", featuredId: 9, helperInstalled: true, suffix: " | A" });
    expect(p).toEqual({
      title: "T",
      slug: "t",
      content: "<p>y</p>",
      excerpt: "e",
      status: "draft",
      categories: [1],
      tags: [5],
      featured_media: 9,
      meta: { _yoast_wpseo_title: "S | A", _yoast_wpseo_metadesc: "d".repeat(130), _yoast_wpseo_focuskw: "kw" },
    });
  });
  it("omits meta without the helper", () => {
    expect(buildPostPayload(article, { html: "", featuredId: null, helperInstalled: false, suffix: null }).meta).toBeUndefined();
  });
  it("publish payload now vs future", () => {
    expect(buildPublishPayload()).toEqual({ status: "publish" });
    expect(buildPublishPayload("2030-01-01T09:00:00.000Z")).toEqual({ status: "future", date_gmt: "2030-01-01T09:00:00" });
  });
  it("validates required fields for push", () => {
    expect(validateForPush(article)).toBeNull();
    expect(validateForPush({ ...article, featured_media: null })).toMatch(/featured/i);
    expect(validateForPush({ ...article, slug: "Bad Slug" })).toMatch(/slug/i);
    expect(validateForPush({ ...article, content_html: "  " })).toMatch(/content/i);
  });
});
