import { describe, it, expect } from "vitest";
import { fakeStore, job, BRAND } from "@/lib/ai/fake-store";
import { buildBrief } from "@/lib/ai/brief";

const post = { id: "44444444-4444-4444-8444-444444444444", brand_id: BRAND.id, title: "New deck", link_url: null, media: [{ url: "https://cdn/a.jpg", alt: "deck" }], status: "draft" as const, category_id: null, targets: [] };

describe("buildBrief", () => {
  it("caption brief carries the post, guidelines, mix and recent captions", async () => {
    const store = fakeStore({ posts: [post, { ...post, id: "55555555-5555-4555-8555-555555555555", status: "published", targets: [{ platform: "facebook", caption: "Old one", scheduled_at: null }] }] });
    const b = await buildBrief(store, job());
    expect(b.post?.id).toBe(post.id);
    expect(b.guidelines.social_style).toBe("Be upbeat.");
    expect(b.recent_captions).toEqual([{ platform: "facebook", caption: "Old one" }]);
    expect(b.instructions).toMatch(/submit_captions/);
  });
  it("article brief includes media and existing articles", async () => {
    const store = fakeStore({ media: [{ id: "m", url: "https://cdn/a.jpg", alt: "a", tags: [], used_as_featured: false }] });
    const b = await buildBrief(store, job({ type: "article", input: { topic: "Deck staining", decision: "new", secondary_keywords: [] } }));
    expect(b.media).toHaveLength(1);
    expect(b.existing_articles).toEqual([]);
  });
  it("fails clearly when the source record is missing", async () => {
    await expect(buildBrief(fakeStore(), job({ type: "promo", input: { article_id: "66666666-6666-4666-8666-666666666666" } }))).rejects.toThrow(/Article .* not found/);
  });
});
