import { z } from "zod";
import { defineTool, requireBrand, ToolError, type ToolCtx } from "./types";
import { rankOpportunities } from "@/lib/seo/score";
import { normaliseKeyword } from "@/lib/seo/score";
import { checkCannibalization, type CannibalizationResult } from "@/lib/seo/cannibalization";
import { dataFreshness } from "@/lib/seo/freshness";

const brand = z.string().describe("Brand slug");

/** Shared by the tool and by create_article's enforcement. */
export async function runCannibalizationCheck(ctx: ToolCtx, brandId: string, keyword: string, slug?: string): Promise<CannibalizationResult> {
  const kw = normaliseKeyword(keyword);
  const [articles, sitePages, gscPages, keywords, imports] = await Promise.all([ctx.store.listArticleKeywordRefs(brandId), ctx.store.listSitePages(brandId), ctx.store.listGscQueryPages(brandId, 28), ctx.store.listKeywords(brandId), ctx.store.listImports(brandId)]);
  const mirror = imports.find((i) => i.kind === "site_mirror");
  return checkCannibalization({
    keyword: kw, slug, articles, sitePages: sitePages.map((p) => ({ slug: p.slug, url: p.url, title: p.title, type: p.type, focus_keyword: p.focus_keyword })),
    gscPages: gscPages.filter((g) => g.query === kw).map((g) => ({ page: g.page, position: g.position, clicks: g.clicks })),
    opportunityKeywords: keywords.map((k) => k.keyword), siteMirroredAt: mirror?.created_at ?? null, pagesMirrored: sitePages.length,
  });
}

export const listKeywordOpportunities = defineTool({
  name: "list_keyword_opportunities",
  description: "Ranked keyword opportunities for a brand (Search Console striking distance + imported keyword research + SEMrush gap), best first: keyword, cluster, volume, difficulty, intent, best competitor + position, our position/page, suggested_action (NEW or OPTIMIZE), score. Use this to pick what to write next. Check `data_freshness` and say so when it is stale.",
  input: z.object({ brand, cluster: z.string().optional(), action: z.enum(["NEW", "OPTIMIZE"]).optional(), q: z.string().optional(), limit: z.number().int().min(1).max(100).default(25) }),
  run: async (ctx, { brand: slug, cluster, action, q, limit }) => {
    const b = await requireBrand(ctx, slug);
    const [keywords, refs, imports] = await Promise.all([ctx.store.listKeywords(b.id), ctx.store.listArticleKeywordRefs(b.id), ctx.store.listImports(b.id)]);
    const targeted = new Set(refs.flatMap((a) => [a.primary_keyword ? normaliseKeyword(a.primary_keyword) : ""]).filter(Boolean));
    const ranked = rankOpportunities(keywords, targeted, { cluster, action, q });
    return {
      count: Math.min(limit, ranked.length),
      total: ranked.length,
      data_freshness: dataFreshness(imports),
      clusters: [...new Set(keywords.map((k) => k.cluster).filter(Boolean))].sort(),
      opportunities: ranked.slice(0, limit).map((k) => ({ keyword: k.keyword, cluster: k.cluster, volume: k.volume, difficulty: k.difficulty, intent: k.intent, best_competitor: k.competitor, best_position: k.competitor_position, our_position: k.our_position, our_page: k.our_page, our_impressions: k.our_impressions, suggested_action: k.action, score: k.score, source: k.source })),
    };
  },
});

export const checkCannibalizationTool = defineTool({
  name: "check_cannibalization",
  description: "Before writing a NEW article, check whether a keyword or slug already has a page so you don't compete with yourself. Checks JamSam articles, the mirrored live WordPress site, and Search Console rankings. Trust `has_conflict`; a keyword merely being an opportunity is NOT a conflict. If true, prefer OPTIMIZE/REWRITE of the existing page; if `live_page_using_this_slug` is set, pick a different slug. Read `live_site_check.note`. ALWAYS run this on your target keyword before create_article.",
  input: z.object({ brand, keyword: z.string().min(1), slug: z.string().optional() }),
  run: async (ctx, { brand: slug, keyword, slug: proposed }) => runCannibalizationCheck(ctx, (await requireBrand(ctx, slug)).id, keyword, proposed),
});

export const searchSitePages = defineTool({
  name: "search_site_pages",
  description: "Search the mirror of the brand's live WordPress site (published posts and pages): title, slug, url, excerpt, focus keyword. Use for internal links and to see what already exists.",
  input: z.object({ brand, q: z.string().optional(), limit: z.number().int().min(1).max(100).default(20) }),
  run: async (ctx, { brand: slug, q, limit }) => (await ctx.store.listSitePages((await requireBrand(ctx, slug)).id, q)).slice(0, limit).map((p) => ({ title: p.title, slug: p.slug, url: p.url, type: p.type, excerpt: p.excerpt, focus_keyword: p.focus_keyword, featured_image_url: p.featured_image_url })),
});

export const searchProjects = defineTool({
  name: "search_projects",
  description: "Search the brand's project content bank (imported or crawled project pages) for source material and photos: title, url, category, location, dims, description, images. Use this to find a real project to post about; write only from the facts returned.",
  input: z.object({ brand, q: z.string().optional().describe("Full-text query, e.g. '36x30 shop Ellensburg'"), category: z.string().optional(), state: z.string().length(2).optional(), limit: z.number().int().min(1).max(50).default(10) }),
  run: async (ctx, { brand: slug, q, category, state, limit }) => (await ctx.store.searchProjects((await requireBrand(ctx, slug)).id, { q, category, state, limit })).map((p) => ({ id: p.id, title: p.title, url: p.url, category: p.category, location: p.location, state: p.state, dims: p.dims, description: p.description, images: p.images, external_id: p.external_id, tags: p.tags })),
});

export const assignClusters = defineTool({
  name: "assign_clusters",
  description: "Terminal tool for a keyword-clustering job: assign a cluster name to each keyword. Unknown keywords are ignored; returns { assigned }.",
  input: z.object({ brand, assignments: z.array(z.object({ keyword: z.string().min(1), cluster: z.string().min(1).max(60) })).min(1).max(400) }),
  run: async (ctx, { brand: slug, assignments }) => {
    const b = await requireBrand(ctx, slug);
    const assigned = await ctx.store.setClusters(b.id, assignments.map((a) => ({ keyword: normaliseKeyword(a.keyword), cluster: a.cluster.trim() })));
    if (assigned === 0) throw new ToolError("None of those keywords exist for this brand; use the exact keyword strings from the brief.");
    return { assigned };
  },
});

const cleanDomain = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

export const importKeywords = defineTool({
  name: "import_keywords",
  description: "Import or refresh keyword research for a brand (same shape as the SEO page's CSV import; merges by keyword and keeps Search Console data). Use this to feed SEMrush data pulled through the SEMrush connector on plans without API access: run `phrase_these` (export_columns keyword, volume, keyword_difficulty, intent) for volume/KD/intent, or `domain_domains` for the competitor keyword gap, then pass the rows here with source=semrush. Returns { imported, skipped }.",
  input: z.object({
    brand,
    source: z.enum(["semrush", "manual"]).default("semrush").describe("semrush = pulled from SEMrush (counts as a data refresh); manual = your own list"),
    keywords: z.array(z.object({
      keyword: z.string().min(1),
      cluster: z.string().max(60).optional(),
      volume: z.number().int().nonnegative().optional().describe("Monthly search volume"),
      difficulty: z.number().min(0).max(100).optional().describe("Keyword difficulty 0-100"),
      intent: z.string().optional().describe("Informational / Commercial / Navigational / Transactional"),
      competitor: z.string().optional().describe("Best-ranking competitor domain"),
      competitor_position: z.number().int().positive().optional(),
      our_position: z.number().int().positive().optional(),
    })).min(1).max(500),
  }),
  run: async (ctx, { brand: slug, source, keywords }) => {
    const b = await requireBrand(ctx, slug);
    const rows = new Map<string, (typeof keywords)[number] & { source: typeof source }>();
    let skipped = 0;
    for (const k of keywords) {
      const keyword = normaliseKeyword(k.keyword);
      if (!keyword) { skipped++; continue; }
      if (rows.has(keyword)) skipped++; // last occurrence wins, as in the CSV import
      rows.set(keyword, { ...k, keyword, competitor: k.competitor ? cleanDomain(k.competitor) : undefined, source });
    }
    const imported = await ctx.store.upsertKeywords(b.id, [...rows.values()]);
    if (source === "semrush") await ctx.store.logImport(b.id, "semrush_refresh", "via Claude (SEMrush connector)", imported, ctx.actor.userId ?? null);
    else await ctx.store.logImport(b.id, "keywords_manual", "via Claude", imported, ctx.actor.userId ?? null);
    return { imported, skipped };
  },
});

export const SEO_TOOLS = [listKeywordOpportunities, checkCannibalizationTool, searchSitePages, searchProjects, assignClusters, importKeywords];
