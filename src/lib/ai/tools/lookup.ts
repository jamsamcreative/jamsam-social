import { z } from "zod";
import { defineTool, requireBrand, ToolError } from "./types";
import { computeContentMix } from "../content-mix";
import { GUIDELINE_KINDS, type GuidelineKind } from "@/lib/guidelines/kinds";

const brand = z.string().describe("Brand slug, e.g. 'acme'. Use list_brands to discover slugs.");
const KINDS = GUIDELINE_KINDS.map((k) => k.kind) as [GuidelineKind, ...GuidelineKind[]];

export const listBrands = defineTool({
  name: "list_brands",
  description: "List active brands with slug, name, timezone, website, SEO suffix and which connections are live (wordpress/meta/pinterest/semrush).",
  input: z.object({}),
  run: (ctx) => ctx.store.listBrands(),
});

export const getBrandGuidelines = defineTool({
  name: "get_brand_guidelines",
  description:
    "Fetch a brand's writing rules. ALWAYS call this before writing anything. For captions read social_style + social_post_spec; for articles read blog_style + blog_post_spec. Omit kind to get every document.",
  input: z.object({ brand, kind: z.enum(KINDS).optional() }),
  run: async (ctx, { brand: slug, kind }) => {
    const b = await requireBrand(ctx, slug);
    const docs = await ctx.store.getGuidelines(b.id);
    return kind ? { [kind]: docs[kind] } : docs;
  },
});

export const getContentMix = defineTool({
  name: "get_content_mix",
  description: "How the brand's recent approved/published posts are tracking against its category targets, and which category to favour next. Empty if the brand has no categories.",
  input: z.object({ brand }),
  run: async (ctx, { brand: slug }) => {
    const b = await requireBrand(ctx, slug);
    const [cats, posts] = await Promise.all([ctx.store.listCategories(b.id), ctx.store.listRecentCategorizedPosts(b.id)]);
    return computeContentMix(cats, posts);
  },
});

export const listMediaAssets = defineTool({
  name: "list_media_assets",
  description: "The brand's image library: id, url, alt, tags, used_as_featured. Filter by tag or a text query on alt/filename. Prefer images with used_as_featured=false for a featured image.",
  input: z.object({ brand, tag: z.string().optional(), query: z.string().optional() }),
  run: async (ctx, { brand: slug, tag, query }) => ctx.store.listMedia((await requireBrand(ctx, slug)).id, { tag, query }),
});

export const searchWpMedia = defineTool({
  name: "search_wp_media",
  description: "Search the brand's WordPress media library by text. Returns id, source_url, alt_text, title. Errors if WordPress is not connected.",
  input: z.object({ brand, query: z.string().min(1), per_page: z.number().int().min(1).max(50).default(20) }),
  run: async (ctx, { brand: slug, query, per_page }) => ctx.store.searchWpMedia((await requireBrand(ctx, slug)).id, query, per_page),
});

export const listArticles = defineTool({
  name: "list_articles",
  description: "List the brand's articles (id, title, slug, status, url, primary_keyword). Use for internal links and to avoid duplicate topics.",
  input: z.object({ brand, status: z.array(z.enum(["draft", "pushed_to_wp", "published", "archived"])).optional() }),
  run: async (ctx, { brand: slug, status }) => ctx.store.listArticles((await requireBrand(ctx, slug)).id, status),
});

export const getArticle = defineTool({
  name: "get_article",
  description: "Fetch one article in full (content_html, excerpt, featured_media, url, published_at).",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, { id }) => {
    const a = await ctx.store.getArticle(id);
    if (!a) throw new ToolError(`Article ${id} not found`);
    return a;
  },
});

export const listPosts = defineTool({
  name: "list_posts",
  description: "Recent posts with captions, category and status. Reference material for tone, and the source for rewrite jobs.",
  input: z.object({
    brand,
    status: z.array(z.enum(["draft", "pending_approval", "approved", "publishing", "published", "failed", "archived"])).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  run: async (ctx, { brand: slug, status, limit }) => ctx.store.listPosts((await requireBrand(ctx, slug)).id, status, limit),
});

export const LOOKUP_TOOLS = [listBrands, getBrandGuidelines, getContentMix, listMediaAssets, searchWpMedia, listArticles, getArticle, listPosts];
