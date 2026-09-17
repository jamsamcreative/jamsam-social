import { describe, it, expect } from "vitest";
import { mirrorSite } from "./mirror";
import type { WpClient } from "@/lib/wordpress/client";

const POST = {
  id: 7, slug: "pole-barn-sizes", link: "https://acme.com/pole-barn-sizes/", modified_gmt: "2026-01-02T03:04:05",
  title: { rendered: "Pole Barn Sizes &#8211; A Guide" }, excerpt: { rendered: "<p>Common sizes &amp; prices.</p>" },
  content: { rendered: "<!-- wp:paragraph --><p>Most <strong>pole barns</strong> are 30x40.</p><!-- /wp:paragraph -->" },
  meta: { _yoast_wpseo_focuskw: "pole barn sizes" }, _embedded: { "wp:featuredmedia": [{ source_url: "https://acme.com/img.jpg" }] },
};

function fakeClient(byType: Record<string, unknown[]>, calls: Record<string, string>[] = []): WpClient {
  return {
    async get<T>(path: string, params?: Record<string, string>) {
      calls.push({ path, ...(params ?? {}) });
      const data = (byType[path] ?? []) as T;
      return { data, headers: new Headers({ "X-WP-TotalPages": "1" }) };
    },
  } as unknown as WpClient;
}

describe("mirrorSite", () => {
  it("maps posts and pages including the rendered body as content_html", async () => {
    const calls: Record<string, string>[] = [];
    const client = fakeClient({ "/wp/v2/posts": [POST], "/wp/v2/pages": [{ id: 2, slug: "about", link: "https://acme.com/about/", title: { rendered: "About" } }] }, calls);
    const pages = await mirrorSite(client);
    expect(pages).toEqual([
      {
        wp_id: 7, type: "post", slug: "pole-barn-sizes", url: "https://acme.com/pole-barn-sizes/", title: "Pole Barn Sizes - A Guide", excerpt: "Common sizes & prices.",
        focus_keyword: "pole barn sizes", featured_image_url: "https://acme.com/img.jpg", modified_at: "2026-01-02T03:04:05Z",
        content_html: "<!-- wp:paragraph --><p>Most <strong>pole barns</strong> are 30x40.</p><!-- /wp:paragraph -->",
      },
      { wp_id: 2, type: "page", slug: "about", url: "https://acme.com/about/", title: "About", excerpt: null, focus_keyword: null, featured_image_url: null, modified_at: null, content_html: "" },
    ]);
  });

  it("requests the content field from the REST API", async () => {
    const calls: Record<string, string>[] = [];
    await mirrorSite(fakeClient({}, calls));
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c._fields.split(",")).toContain("content");
  });
});
