import { describe, it, expect } from "vitest";
import { fakeStore, BRAND, job } from "@/lib/ai/fake-store";
import { listKeywordOpportunities, checkCannibalizationTool, searchProjects, assignClusters, importKeywords } from "@/lib/ai/tools/seo";
import { createArticle } from "@/lib/ai/tools/write";
import { buildBrief } from "@/lib/ai/brief";
import type { Keyword, SitePage } from "@/lib/ai/store";

const kw = (o: Partial<Keyword>): Keyword => ({ id: "k", brand_id: BRAND.id, keyword: "x", cluster: null, volume: null, difficulty: null, intent: null, competitor: null, competitor_position: null, our_position: null, our_impressions: null, our_clicks: null, our_page: null, source: "csv", notes: null, imported_at: "2026-09-01T00:00:00Z", refreshed_at: null, ...o });
const pg = (o: Partial<SitePage>): SitePage => ({ id: "p", brand_id: BRAND.id, wp_id: 1, type: "post", slug: "horse-barns", url: "https://acme.com/horse-barns/", title: "Horse Barns: Sizes", excerpt: null, focus_keyword: "horse barns", featured_image_url: null, modified_at: null, mirrored_at: "2026-09-10T00:00:00Z", content_text: null, content_hash: null, word_count: null, ...o });
const ctx = (store = fakeStore()) => ({ store, actor: { kind: "in_app" as const } });

describe("seo tools", () => {
  it("list_keyword_opportunities ranks, filters, reports freshness and clusters", async () => {
    const store = fakeStore({ keywords: [kw({ keyword: "horse barns", cluster: "Agricultural", volume: 3600, difficulty: 39, intent: "Commercial", our_page: "/horse-barns/", our_position: 17 }), kw({ id: "k2", keyword: "barn kits", cluster: "Barndos", volume: 590, difficulty: 8, intent: "Commercial" })] });
    const out = (await listKeywordOpportunities.run(ctx(store), { brand: "acme", limit: 25 })) as { opportunities: { keyword: string; suggested_action: string }[]; clusters: string[]; data_freshness: { stale: boolean } };
    expect(out.opportunities[0]).toMatchObject({ keyword: "horse barns", suggested_action: "OPTIMIZE (ranks #17)" });
    expect(out.clusters).toEqual(["Agricultural", "Barndos"]);
    expect(out.data_freshness.stale).toBe(false);
    const onlyNew = (await listKeywordOpportunities.run(ctx(store), { brand: "acme", action: "NEW", limit: 25 })) as { opportunities: unknown[] };
    expect(onlyNew.opportunities).toHaveLength(1);
  });
  it("check_cannibalization uses articles, site pages and GSC", async () => {
    const store = fakeStore({ sitePages: [pg({})], imports: [{ id: "i", brand_id: BRAND.id, kind: "site_mirror", detail: null, rows: 1, created_by: null, created_at: "2026-09-10T00:00:00Z" }] });
    const r = (await checkCannibalizationTool.run(ctx(store), { brand: "acme", keyword: "Horse Barns", slug: "horse-barns" })) as { has_conflict: boolean; live_site_check: { pages_mirrored: number } };
    expect(r.has_conflict).toBe(true);
    expect(r.live_site_check.pages_mirrored).toBe(1);
  });
  it("create_article refuses a conflicting NEW article but allows optimize", async () => {
    const store = fakeStore({ sitePages: [pg({})] });
    const base = { brand: "acme", title: "Horse Barns Guide", slug: "horse-barns", content_html: "<p>x</p>", featured_media_url: "https://cdn/x.jpg", featured_alt: "a", secondary_keywords: [], categories: [], tags: [], primary_keyword: "horse barns" };
    await expect(createArticle.run(ctx(store), { ...base, decision: "new" })).rejects.toThrow(/CONFLICT/);
    expect(store.created.articles).toHaveLength(0);
    await createArticle.run(ctx(store), { ...base, decision: "optimize" });
    expect(store.created.articles).toHaveLength(1);
  });
  it("search_projects and assign_clusters", async () => {
    const store = fakeStore({ projects: [{ id: "p1", brand_id: BRAND.id, external_id: "4521", title: "36x30 Shop Ellensburg", url: "https://x/p/1", category: "Shop", location: "Ellensburg, WA", state: "WA", dims: "36x30", description: "Nice", images: [], tags: [], imported_at: "2026-09-01T00:00:00Z" }], keywords: [kw({ keyword: "metal roofing spokane" }), kw({ id: "k2", keyword: "pole barn kits" })] });
    expect(await searchProjects.run(ctx(store), { brand: "acme", q: "ellensburg", limit: 10 })).toHaveLength(1);
    expect(await searchProjects.run(ctx(store), { brand: "acme", state: "or", limit: 10 })).toHaveLength(0);
    expect(await assignClusters.run(ctx(store), { brand: "acme", assignments: [{ keyword: "Metal Roofing Spokane", cluster: "Metal Roofing" }, { keyword: "nope", cluster: "X" }] })).toEqual({ assigned: 1 });
    expect(store.keywords[0].cluster).toBe("Metal Roofing");
    await expect(assignClusters.run(ctx(store), { brand: "acme", assignments: [{ keyword: "nope", cluster: "X" }] })).rejects.toThrow(/exact keyword/);
  });
  it("import_keywords normalises, dedups, upserts and logs a SEMrush refresh", async () => {
    const store = fakeStore({ keywords: [kw({ keyword: "horse barns", volume: 100 })] });
    const out = await importKeywords.run(ctx(store), { brand: "acme", source: "semrush", keywords: [
      { keyword: " Horse  Barns ", volume: 3600, difficulty: 39, intent: "Commercial" },
      { keyword: "barn kits", volume: 590 },
      { keyword: "barn kits", volume: 600, competitor: "https://www.mqsbarn.com/x", competitor_position: 4 },
      { keyword: "   " },
    ] });
    expect(out).toEqual({ imported: 2, skipped: 2 });
    expect(store.keywords.find((k) => k.keyword === "horse barns")).toMatchObject({ volume: 3600, difficulty: 39, source: "semrush" });
    expect(store.keywords.find((k) => k.keyword === "barn kits")).toMatchObject({ volume: 600, competitor: "mqsbarn.com", competitor_position: 4 });
    expect(store.imports[0]).toMatchObject({ kind: "semrush_refresh", rows: 2 });
    expect(store.imports[0].detail).toMatch(/Claude/);
  });
  it("import_keywords with source=manual logs keywords_manual and rejects unknown brands", async () => {
    const store = fakeStore();
    await importKeywords.run(ctx(store), { brand: "acme", source: "manual", keywords: [{ keyword: "pole barns" }] });
    expect(store.keywords[0]).toMatchObject({ keyword: "pole barns", source: "manual" });
    expect(store.imports[0].kind).toBe("keywords_manual");
    await expect(importKeywords.run(ctx(store), { brand: "nope", source: "manual", keywords: [{ keyword: "x" }] })).rejects.toThrow();
  });
  it("briefs carry the opportunity for article jobs and keywords for cluster jobs", async () => {
    const store = fakeStore({ keywords: [kw({ keyword: "metal roofing spokane", cluster: "Metal Roofing", volume: 480 }), kw({ id: "k2", keyword: "pole barn kits" })] });
    const a = await buildBrief(store, job({ type: "article", input: { topic: "Metal roofing Spokane guide", primary_keyword: "metal roofing spokane", decision: "new", secondary_keywords: [] } }));
    expect(a.opportunity).toMatchObject({ keyword: "metal roofing spokane", suggested_action: "NEW" });
    const c = await buildBrief(store, job({ type: "seo_cluster", input: { limit: 300 } }));
    expect(c.keywords?.map((k) => k.keyword)).toEqual(["pole barn kits"]);
    expect(c.existing_clusters).toEqual(["Metal Roofing"]);
    expect(c.instructions).toMatch(/assign_clusters/);
  });
});
