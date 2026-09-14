import { describe, it, expect } from "vitest";
import { filterSitemapUrls, extractProjectFromHtml } from "@/lib/seo/extract";

describe("extract", () => {
  it("filters sitemap urls by host and prefix, and detects index sitemaps", () => {
    const xml = `<urlset><url><loc>https://www.x.com/projects/a/</loc></url><url><loc>https://x.com/projects/b/</loc></url><url><loc>https://x.com/blog/c/</loc></url><url><loc>https://evil.com/projects/d/</loc></url></urlset>`;
    expect(filterSitemapUrls(xml, "/projects/", "x.com").urls).toEqual(["https://www.x.com/projects/a/", "https://x.com/projects/b/"]);
    const idx = `<sitemapindex><sitemap><loc>https://x.com/post-sitemap.xml</loc></sitemap></sitemapindex>`;
    expect(filterSitemapUrls(idx, "/projects/", "x.com")).toEqual({ urls: [], childSitemaps: ["https://x.com/post-sitemap.xml"] });
  });
  it("extracts title, description, images, dims, location and job number from a page", () => {
    const html = `<html><head><title>36x30 Shop in Ellensburg, WA | SSA</title><meta property="og:image" content="https://x.com/img/hero.jpg"><meta name="description" content="A 36 x 30 shop built for a family in Ellensburg, WA. Job #4521."></head>
      <body><img src="/img/logo.svg"><main><h1>36x30 Shop</h1><p>Job number 4521. Great build.</p><img src="/img/1.jpg" alt="Front view"><img src="https://x.com/img/hero.jpg"></main></body></html>`;
    const p = extractProjectFromHtml(html, "https://x.com/projects/36x30-shop/");
    expect(p.title).toBe("36x30 Shop in Ellensburg, WA | SSA");
    expect(p.description).toMatch(/36 x 30 shop/);
    expect(p.images).toEqual([{ url: "https://x.com/img/hero.jpg" }, { url: "https://x.com/img/1.jpg", alt: "Front view" }]);
    expect(p).toMatchObject({ dims: "36x30", state: "WA", location: "Ellensburg, WA", external_id: "4521" });
  });
});
