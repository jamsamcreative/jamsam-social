import { describe, it, expect } from "vitest";
import { fakeStore, BRAND, job } from "@/lib/ai/fake-store";
import { createPost, submitCaptions, createArticle } from "@/lib/ai/tools/write";

const ctx = (store = fakeStore()) => ({ store, actor: { kind: "in_app" as const } });
const good = { facebook: "We're on site and it's looking great 🔥", instagram: "We're on site and it's looking great 🔥" };

describe("create_post", () => {
  it("creates a pending_approval post with targets and category", async () => {
    const store = fakeStore({ categories: [{ id: "c1", name: "Tips", slug: "tips", target_share: 1, description: null, sort_order: 0 }] });
    const out = await createPost.run(ctx(store), { brand: "acme", title: "T", targets: [{ platform: "facebook", caption: good.facebook }], media_urls: [], category_slug: "tips" });
    expect(out).toEqual({ post_id: "11111111-1111-4111-8111-111111111111" });
    expect(store.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ brand_id: BRAND.id, category_id: "c1", source: "ai", targets: [{ platform: "facebook", caption: good.facebook, scheduled_at: null }] }),
    );
  });
  it("rejects captions that break hard rules and creates nothing", async () => {
    const store = fakeStore();
    await expect(createPost.run(ctx(store), { brand: "acme", title: "T", targets: [{ platform: "facebook", caption: "Actually — fine" }], media_urls: [] })).rejects.toThrow(/em dash/);
    expect(store.createPost).not.toHaveBeenCalled();
  });
  it("rejects an unknown category slug", async () => {
    await expect(createPost.run(ctx(), { brand: "acme", title: "T", targets: [{ platform: "facebook", caption: good.facebook }], media_urls: [], category_slug: "nope" })).rejects.toThrow(/category/i);
  });
});

describe("submit_captions", () => {
  it("writes the result onto a running job", async () => {
    const store = fakeStore({ jobs: [job({ status: "running" })] });
    await submitCaptions.run(ctx(store), { job_id: store.jobs[0].id, captions: good });
    expect(store.jobs[0].result).toEqual({ captions: good });
  });
  it("validates captions", async () => {
    const store = fakeStore({ jobs: [job({ status: "running" })] });
    await expect(submitCaptions.run(ctx(store), { job_id: store.jobs[0].id, captions: { ...good, instagram: "it's actually" } })).rejects.toThrow(/actually/);
  });
});

describe("create_article", () => {
  const base = {
    brand: "acme", title: "Deck Staining Guide", slug: "deck-staining-guide", content_html: "<h2>Why</h2><p>Because.</p>", featured_media_url: "https://cdn/x.jpg", featured_alt: "A deck",
    decision: "new" as const, secondary_keywords: [], categories: [], tags: [],
  };
  it("creates a draft and returns warnings for SEO fields", async () => {
    const store = fakeStore();
    const out = (await createArticle.run(ctx(store), { ...base, seo_title: "Deck Staining", meta_description: "short" })) as { article_id: string; warnings: string[] };
    expect(out.article_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(out.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/suffix/), expect.stringMatching(/120/)]));
    expect(store.createArticle).toHaveBeenCalledWith(expect.objectContaining({ brand_id: BRAND.id, source: "ai", featured_media: { url: "https://cdn/x.jpg", alt: "A deck" } }));
  });
  it("rejects data: image URLs", async () => {
    await expect(createArticle.run(ctx(), { ...base, content_html: '<img src="data:image/png;base64,AAA">' })).rejects.toThrow(/data:/);
  });
});
