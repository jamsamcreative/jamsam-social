import type { Store, StoreJob, StoreBrand, PostSummary, ArticleFull, ArticleSummary, StoreMedia } from "./store";
import { computeContentMix, type ContentMix } from "./content-mix";
import { parseJobInput, type JobType } from "./schemas";
import { INSTRUCTIONS, HARD_RULES } from "./prompts/instructions";
import type { GuidelineKind } from "@/lib/guidelines/kinds";
import { normaliseKeyword, rankOpportunities } from "@/lib/seo/score";

export type Brief = {
  job: { id: string; type: JobType; input: unknown };
  brand: StoreBrand;
  guidelines: Record<GuidelineKind, string>;
  content_mix: ContentMix;
  post?: PostSummary;
  article?: ArticleFull;
  media?: StoreMedia[];
  existing_articles?: ArticleSummary[];
  recent_captions?: { platform: string; caption: string }[];
  site_pages?: { title: string; url: string; slug: string; focus_keyword: string | null }[];
  opportunity?: { keyword: string; cluster: string | null; volume: number | null; difficulty: number | null; intent: string | null; our_page: string | null; our_position: number | null; suggested_action: string; score: number } | null;
  keywords?: { keyword: string; volume: number | null; intent: string | null }[];
  existing_clusters?: string[];
  asset?: { id: string; url: string; alt: string | null; tags: string[] } | null;
  project?: { id: string; title: string; url: string | null; category: string | null; location: string | null; state: string | null; dims: string | null; description: string | null; images: unknown } | null;
  boards?: { board_id: string; name: string; pins_in_app: number; measured: number; median_impressions: number | null }[];
  recent_pin_titles?: string[];
  hard_rules: string;
  instructions: string;
};

/** Everything a writer (in-app agent or MCP client) needs to do the job, resolved from the DB. */
export async function buildBrief(store: Store, j: StoreJob): Promise<Brief> {
  const parsed = parseJobInput(j.type, j.input);
  if (!parsed.success) throw new Error(`Job ${j.id} has invalid input: ${parsed.error.issues[0]?.message}`);
  const input = parsed.data as Record<string, string>;
  const brand = await store.getBrandById(j.brand_id);
  if (!brand) throw new Error(`Brand ${j.brand_id} not found`);
  const [guidelines, cats, recentPosts] = await Promise.all([store.getGuidelines(brand.id), store.listCategories(brand.id), store.listRecentCategorizedPosts(brand.id)]);
  const brief: Brief = { job: { id: j.id, type: j.type, input: parsed.data }, brand, guidelines, content_mix: computeContentMix(cats, recentPosts), hard_rules: HARD_RULES, instructions: INSTRUCTIONS[j.type] };

  const recentCaptions = async () =>
    (await store.listPosts(brand.id, ["approved", "published"], 5)).flatMap((p) => p.targets.map((t) => ({ platform: t.platform, caption: t.caption })));

  if (j.type === "caption" || j.type === "rewrite") {
    const post = await store.getPost(input.post_id);
    if (!post) throw new Error(`Post ${input.post_id} not found`);
    brief.post = post;
    brief.recent_captions = await recentCaptions();
  }
  if (j.type === "promo") {
    const article = await store.getArticle(input.article_id);
    if (!article) throw new Error(`Article ${input.article_id} not found`);
    brief.article = article;
    brief.recent_captions = await recentCaptions();
  }
  if (j.type === "article") {
    const [media, existing, pages, keywords] = await Promise.all([store.listMedia(brand.id), store.listArticles(brand.id), store.listSitePages(brand.id), store.listKeywords(brand.id)]);
    brief.media = media;
    brief.existing_articles = existing;
    brief.site_pages = pages.slice(0, 300).map((p) => ({ title: p.title, url: p.url, slug: p.slug, focus_keyword: p.focus_keyword }));
    const want = normaliseKeyword(input.primary_keyword || input.topic || "");
    const hit = keywords.find((k) => k.keyword === want) ?? keywords.find((k) => want.includes(k.keyword) || k.keyword.includes(want));
    if (hit) {
      const [r] = rankOpportunities([hit], new Set());
      brief.opportunity = { keyword: r.keyword, cluster: r.cluster, volume: r.volume, difficulty: r.difficulty, intent: r.intent, our_page: r.our_page, our_position: r.our_position, suggested_action: r.action, score: r.score };
    } else brief.opportunity = null;
  }
  if (j.type === "pin") {
    const inp = parsed.data as { media_asset_id?: string; project_id?: string };
    if (inp.media_asset_id) {
      const a = await store.getMediaAsset(inp.media_asset_id);
      if (!a) throw new Error(`Media asset ${inp.media_asset_id} not found`);
      brief.asset = { id: a.id, url: a.url, alt: a.alt, tags: a.tags };
    }
    if (inp.project_id) {
      const p = await store.getProject(inp.project_id);
      if (!p) throw new Error(`Project ${inp.project_id} not found`);
      brief.project = { id: p.id, title: p.title, url: p.url, category: p.category, location: p.location, state: p.state, dims: p.dims, description: p.description, images: p.images };
    }
    const [boards, titles] = await Promise.all([store.listPinBoards(brand.id), store.listRecentPinTitles(brand.id)]);
    brief.boards = boards.map((b) => ({ board_id: b.board_id, name: b.name, pins_in_app: b.pins_in_app, measured: b.measured, median_impressions: b.median_impressions }));
    brief.recent_pin_titles = titles;
  }
  if (j.type === "seo_cluster") {
    const limit = Number((parsed.data as { limit?: number }).limit ?? 300);
    const [unclustered, all] = await Promise.all([store.listKeywords(brand.id, { unclusteredOnly: true, limit }), store.listKeywords(brand.id)]);
    brief.keywords = unclustered.map((k) => ({ keyword: k.keyword, volume: k.volume, intent: k.intent }));
    brief.existing_clusters = [...new Set(all.map((k) => k.cluster).filter((c): c is string => Boolean(c)))].sort();
  }
  return brief;
}
