import { z } from "zod";
import { defineTool, requireBrand, ToolError, type ToolCtx } from "./types";
import { validateCaption } from "../captions";
import { captionsSchema } from "../schemas";
import { finalSeoTitle, metaDescriptionWarning } from "@/lib/articles/push";
import type { Json, MediaItem } from "@/lib/database.types";
import { runCannibalizationCheck } from "./seo";

const brand = z.string().describe("Brand slug");
const target = z.object({
  platform: z.enum(["facebook", "instagram"]),
  caption: z.string().min(1),
  scheduled_at: z.string().datetime({ offset: true }).optional().describe("ISO 8601 with offset, e.g. 2026-09-20T09:00:00-07:00"),
});

function assertCaptions(pairs: { platform: "facebook" | "instagram"; caption: string }[]) {
  const problems = pairs.flatMap((t) => validateCaption(t.platform, t.caption).map((v) => `${t.platform}: ${v}`));
  if (problems.length) throw new ToolError(`Caption rules violated — fix and call again:\n- ${problems.join("\n- ")}`);
}

async function resolveCategory(ctx: ToolCtx, brandId: string, slug?: string): Promise<string | null> {
  if (!slug) return null;
  const cats = await ctx.store.listCategories(brandId);
  const c = cats.find((x) => x.slug === slug);
  if (!c) throw new ToolError(`Unknown category slug "${slug}". Valid: ${cats.map((x) => x.slug).join(", ") || "(none)"}`);
  return c.id;
}

export const createPost = defineTool({
  name: "create_post",
  description:
    "Create a social post. Lands as pending_approval; a human approves it before anything publishes. Captions must follow the brand's hard rules (no em/en dashes, never 'actually', contractions, platform length) or the call is rejected with the violations.",
  input: z.object({
    brand,
    title: z.string().min(1).max(200).describe("Internal title"),
    targets: z.array(target).min(1).max(2),
    media_urls: z.array(z.string().url()).max(10).default([]),
    media_alts: z.array(z.string()).optional().describe("Alt text per media_urls entry"),
    link_url: z.string().url().optional(),
    category_slug: z.string().optional().describe("From get_content_mix"),
    article_id: z.string().uuid().optional().describe("For promo posts: the article being promoted"),
    recycled_from: z.string().uuid().optional().describe("For rewrite jobs: the original post id"),
  }),
  run: async (ctx, i) => {
    const b = await requireBrand(ctx, i.brand);
    assertCaptions(i.targets);
    const category_id = await resolveCategory(ctx, b.id, i.category_slug);
    const media: MediaItem[] = i.media_urls.map((url, n) => ({ url, alt: i.media_alts?.[n] ?? null }));
    return ctx.store.createPost({
      brand_id: b.id, title: i.title, link_url: i.link_url ?? null, media, category_id,
      source: i.recycled_from ? "recycled" : "ai", recycled_from: i.recycled_from ?? null, created_by: ctx.actor.userId ?? null,
      targets: i.targets.map((t) => ({ platform: t.platform, caption: t.caption, scheduled_at: t.scheduled_at ?? null })),
    });
  },
});

export const submitCaptions = defineTool({
  name: "submit_captions",
  description: "Finish a CAPTION job: hand back Facebook and Instagram captions (and the chosen category slug). Creates nothing; the composer fills the fields for human review.",
  input: z.object({ job_id: z.string().uuid(), captions: captionsSchema, category_slug: z.string().optional() }),
  run: async (ctx, { job_id, captions, category_slug }) => {
    const j = await ctx.store.getJob(job_id);
    if (!j) throw new ToolError(`Job ${job_id} not found`);
    if (j.type !== "caption") throw new ToolError(`Job ${job_id} is a ${j.type} job; submit_captions is only for caption jobs`);
    assertCaptions([{ platform: "facebook", caption: captions.facebook }, { platform: "instagram", caption: captions.instagram }]);
    if (category_slug) await resolveCategory(ctx, j.brand_id, category_slug);
    const result = category_slug ? { captions, category_slug } : { captions };
    await ctx.store.updateJob(job_id, { result: result as Json });
    return { ok: true };
  },
});

const articleFields = {
  title: z.string().min(1).max(200).describe("H1, primary keyword near the front"),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase-hyphenated").describe("Short, contains the primary keyword"),
  content_html: z.string().min(1).describe("Body HTML with <h2>/<h3>, <p>, <ul>, <a>, <img src=hosted-url alt=...>. Never base64/data: images."),
  excerpt: z.string().max(400).optional(),
  seo_title: z.string().max(120).optional().describe("Should end with the brand SEO suffix"),
  meta_description: z.string().max(200).optional().describe("120–156 chars, includes the primary keyword"),
  primary_keyword: z.string().optional(),
  secondary_keywords: z.array(z.string()).max(10).default([]),
  featured_media_url: z.string().url().describe("Hosted image URL (brand library or WP media)"),
  featured_alt: z.string().min(1),
  categories: z.array(z.object({ id: z.number().int(), name: z.string() })).default([]),
  tags: z.array(z.object({ id: z.number().int(), name: z.string() })).default([]),
  decision: z.enum(["new", "rewrite", "optimize"]).default("new"),
  rationale: z.string().max(2000).optional(),
};

function articleWarnings(i: { seo_title?: string; title: string; meta_description?: string; content_html: string }, suffix: string | null): string[] {
  const out: string[] = [];
  const text = i.content_html.replace(/<[^>]+>/g, " ");
  if (/[—–]/.test(text)) out.push("Body contains em/en dashes; rewrite those sentences without dashes");
  if (/\bactually\b/i.test(text)) out.push('Body uses the word "actually"; rewrite those sentences without it');
  const final = finalSeoTitle(i.seo_title ?? null, i.title, suffix);
  if (suffix && i.seo_title && !i.seo_title.trim().endsWith(suffix.trim())) out.push(`seo_title should end with the brand suffix "${suffix}" (will render as "${final}")`);
  const md = metaDescriptionWarning(i.meta_description ?? null);
  if (md) out.push(md);
  return out;
}

const DATA_IMG = /src=["']data:/i;

export const createArticle = defineTool({
  name: "create_article",
  description:
    "Create a blog article draft. ALWAYS read blog_style + blog_post_spec first. Returns { article_id, warnings } — warnings are advisory (SEO title suffix, meta length). Body <img> tags must use hosted URLs; every image is re-hosted into WordPress on push.",
  input: z.object({ brand, ...articleFields }),
  run: async (ctx, i) => {
    const b = await requireBrand(ctx, i.brand);
    if (DATA_IMG.test(i.content_html)) throw new ToolError("content_html contains a data: image URL. Use hosted image URLs from list_media_assets or search_wp_media.");
    // A NEW article must not compete with an existing page; OPTIMIZE/REWRITE may reuse the existing slug on purpose.
    if (i.decision === "new") {
      const check = await runCannibalizationCheck(ctx, b.id, i.primary_keyword ?? i.title, i.slug);
      if (check.has_conflict) throw new ToolError(`${check.verdict} Use decision "optimize" or "rewrite" targeting that page, or choose a different keyword/slug.`);
    }
    const { article_id } = await ctx.store.createArticle({
      brand_id: b.id, title: i.title, slug: i.slug, content_html: i.content_html, excerpt: i.excerpt ?? null, seo_title: i.seo_title ?? null,
      meta_description: i.meta_description ?? null, primary_keyword: i.primary_keyword ?? null, secondary_keywords: i.secondary_keywords,
      featured_media: { url: i.featured_media_url, alt: i.featured_alt }, categories: i.categories, tags: i.tags, decision: i.decision,
      rationale: i.rationale ?? null, source: "ai", created_by: ctx.actor.userId ?? null,
    });
    return { article_id, warnings: articleWarnings(i, b.seo_suffix) };
  },
});

export const updateArticle = defineTool({
  name: "update_article",
  description: "Partially update an existing article draft (same fields as create_article, all optional).",
  input: z.object({
    id: z.string().uuid(),
    title: articleFields.title.optional(),
    slug: articleFields.slug.optional(),
    content_html: articleFields.content_html.optional(),
    excerpt: articleFields.excerpt,
    seo_title: articleFields.seo_title,
    meta_description: articleFields.meta_description,
    primary_keyword: articleFields.primary_keyword,
    secondary_keywords: z.array(z.string()).max(10).optional(),
    featured_media_url: articleFields.featured_media_url.optional(),
    featured_alt: articleFields.featured_alt.optional(),
    categories: z.array(z.object({ id: z.number().int(), name: z.string() })).optional(),
    tags: z.array(z.object({ id: z.number().int(), name: z.string() })).optional(),
    decision: z.enum(["new", "rewrite", "optimize"]).optional(),
    rationale: articleFields.rationale,
  }),
  run: async (ctx, { id, featured_media_url, featured_alt, ...rest }) => {
    const a = await ctx.store.getArticle(id);
    if (!a) throw new ToolError(`Article ${id} not found`);
    if (rest.content_html && DATA_IMG.test(rest.content_html)) throw new ToolError("content_html contains a data: image URL");
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    if (featured_media_url) patch.featured_media = { url: featured_media_url, alt: featured_alt ?? a.featured_media?.alt ?? null };
    await ctx.store.updateArticle(id, patch);
    return { ok: true };
  },
});

export const WRITE_TOOLS = [createPost, submitCaptions, createArticle, updateArticle];
