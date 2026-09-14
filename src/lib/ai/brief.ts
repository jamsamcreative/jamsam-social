import type { Store, StoreJob, StoreBrand, PostSummary, ArticleFull, ArticleSummary, StoreMedia } from "./store";
import { computeContentMix, type ContentMix } from "./content-mix";
import { parseJobInput, type JobType } from "./schemas";
import { INSTRUCTIONS, HARD_RULES } from "./prompts/instructions";
import type { GuidelineKind } from "@/lib/guidelines/kinds";

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
    const [media, existing] = await Promise.all([store.listMedia(brand.id), store.listArticles(brand.id)]);
    brief.media = media;
    brief.existing_articles = existing;
  }
  return brief;
}
