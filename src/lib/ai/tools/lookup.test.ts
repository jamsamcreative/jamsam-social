import { describe, it, expect } from "vitest";
import { fakeStore, BRAND } from "@/lib/ai/fake-store";
import { listBrands, getBrandGuidelines, getContentMix, listMediaAssets, getArticle } from "@/lib/ai/tools/lookup";

const ctx = (store = fakeStore()) => ({ store, actor: { kind: "in_app" as const } });

describe("lookup tools", () => {
  it("list_brands returns slug + connection map", async () => {
    const out = (await listBrands.run(ctx(), {})) as { slug: string; connections: Record<string, string> }[];
    expect(out[0]).toMatchObject({ slug: "acme", connections: { wordpress: "connected" } });
  });
  it("get_brand_guidelines filters by kind and rejects unknown brands", async () => {
    expect(await getBrandGuidelines.run(ctx(), { brand: "acme", kind: "blog_style" })).toEqual({ blog_style: "Helpful." });
    await expect(getBrandGuidelines.run(ctx(), { brand: "nope" })).rejects.toThrow(/Unknown brand/);
  });
  it("get_content_mix computes from categories and recent posts", async () => {
    const store = fakeStore({
      categories: [{ id: "c1", name: "Tips", slug: "tips", target_share: 1, description: null, sort_order: 0 }],
      posts: [{ id: "p", brand_id: BRAND.id, title: "t", link_url: null, media: [], status: "published", category_id: null, targets: [] }],
    });
    expect(await getContentMix.run(ctx(store), { brand: "acme" })).toMatchObject({ total: 1, favour_next: "tips" });
  });
  it("list_media_assets passes tag/query through", async () => {
    const store = fakeStore();
    await listMediaAssets.run(ctx(store), { brand: "acme", tag: "shop", query: "deck" });
    expect(store.listMedia).toHaveBeenCalledWith(BRAND.id, { tag: "shop", query: "deck" });
  });
  it("get_article errors when missing", async () => {
    await expect(getArticle.run(ctx(), { id: "44444444-4444-4444-8444-444444444444" })).rejects.toThrow(/not found/i);
  });
});
