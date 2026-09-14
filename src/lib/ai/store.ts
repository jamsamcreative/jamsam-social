import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import { createWpClient } from "@/lib/wordpress/client";
import type { WordpressConfig, WordpressSecret } from "@/lib/connections/wordpress-shared";
import { GUIDELINE_KINDS, type GuidelineKind } from "@/lib/guidelines/kinds";
import { MIX_WINDOW, type CategoryLike } from "./content-mix";
import type { Database, Json, MediaItem, TermRef } from "@/lib/database.types";
import type { JobStatus, JobRunner } from "./schemas";

type ArticleStatus = Database["public"]["Enums"]["article_status"];
type PostStatus = Database["public"]["Enums"]["post_status"];
type ArticleRow = Database["public"]["Tables"]["articles"]["Row"];
type PostRow = Database["public"]["Tables"]["posts"]["Row"];
export type StoreBrand = { id: string; slug: string; name: string; timezone: string; website_url: string | null; seo_suffix: string | null };
export type StoreJob = Database["public"]["Tables"]["generation_jobs"]["Row"];
export type ArticleSummary = { id: string; brand_id: string; title: string; slug: string; status: ArticleStatus; url: string; primary_keyword: string | null; wp_link: string | null };
export type ArticleFull = ArticleSummary & { content_html: string; excerpt: string | null; featured_media: MediaItem | null; published_at: string | null };
export type PostTargetSummary = { platform: "facebook" | "instagram"; caption: string; scheduled_at: string | null };
export type PostSummary = { id: string; brand_id: string; title: string; link_url: string | null; media: MediaItem[]; status: PostStatus; category_id: string | null; targets: PostTargetSummary[] };
export type CreatePostInput = {
  brand_id: string; title: string; link_url: string | null; media: MediaItem[]; category_id: string | null; source: "ai" | "recycled";
  recycled_from?: string | null; created_by?: string | null; targets: PostTargetSummary[];
};
export type CreateArticleInput = {
  brand_id: string; title: string; slug: string; content_html: string; excerpt: string | null; seo_title: string | null; meta_description: string | null;
  primary_keyword: string | null; secondary_keywords: string[]; featured_media: MediaItem | null; categories: TermRef[]; tags: TermRef[];
  decision: "new" | "rewrite" | "optimize"; rationale: string | null; source: "ai"; created_by?: string | null;
};
export type StoreMedia = { id: string; url: string; alt: string | null; tags: string[]; used_as_featured: boolean };
export type SitePage = Database["public"]["Tables"]["site_pages"]["Row"];
export type Keyword = Database["public"]["Tables"]["keywords"]["Row"];
export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type KeywordImport = Database["public"]["Tables"]["keyword_imports"]["Row"];
export type KeywordUpsert = Partial<Omit<Keyword, "id" | "brand_id" | "imported_at">> & { keyword: string };
export type ArticleKeywordRef = { id: string; title: string; slug: string; status: ArticleStatus; primary_keyword: string | null; secondary_keywords: string[]; wp_link: string | null };
export type WpMediaHit = { id: number; source_url: string; alt_text: string; title: string };

/** Every DB/WP operation the AI layer needs, so tools and the runner can be tested against an in-memory fake. */
export type Store = {
  listBrands(): Promise<(StoreBrand & { connections: Record<string, string> })[]>;
  getBrandBySlug(slug: string): Promise<StoreBrand | null>;
  getBrandById(id: string): Promise<StoreBrand | null>;
  getGuidelines(brandId: string): Promise<Record<GuidelineKind, string>>;
  listCategories(brandId: string): Promise<CategoryLike[]>;
  listRecentCategorizedPosts(brandId: string): Promise<{ category_id: string | null }[]>;
  listMedia(brandId: string, opts?: { tag?: string; query?: string }): Promise<StoreMedia[]>;
  searchWpMedia(brandId: string, query: string, perPage?: number): Promise<WpMediaHit[]>;
  listArticles(brandId: string, status?: ArticleStatus[]): Promise<ArticleSummary[]>;
  getArticle(id: string): Promise<ArticleFull | null>;
  listPosts(brandId: string, status?: PostStatus[], limit?: number): Promise<PostSummary[]>;
  getPost(id: string): Promise<PostSummary | null>;
  createPost(input: CreatePostInput): Promise<{ post_id: string }>;
  createArticle(input: CreateArticleInput): Promise<{ article_id: string }>;
  updateArticle(id: string, patch: Partial<CreateArticleInput>): Promise<void>;
  listJobs(opts: { brandId?: string; status?: JobStatus; runner?: JobRunner }): Promise<StoreJob[]>;
  getJob(id: string): Promise<StoreJob | null>;
  /** Atomic `update … where status in from`; null when 0 rows matched. */
  transitionJob(id: string, from: JobStatus[], patch: Partial<StoreJob>): Promise<StoreJob | null>;
  updateJob(id: string, patch: Partial<StoreJob>): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  // SEO (Phase 5b)
  listSitePages(brandId: string, q?: string): Promise<SitePage[]>;
  listKeywords(brandId: string, opts?: { cluster?: string; unclusteredOnly?: boolean; limit?: number }): Promise<Keyword[]>;
  upsertKeywords(brandId: string, rows: KeywordUpsert[], opts?: { onlyOurFields?: boolean }): Promise<number>;
  setClusters(brandId: string, assignments: { keyword: string; cluster: string | null }[]): Promise<number>;
  searchProjects(brandId: string, opts: { q?: string; category?: string; state?: string; limit?: number }): Promise<Project[]>;
  listArticleKeywordRefs(brandId: string): Promise<ArticleKeywordRef[]>;
  listGscQueryPages(brandId: string, days: number): Promise<{ query: string; page: string; position: number; clicks: number }[]>;
  logImport(brandId: string, kind: string, detail: string | null, rows: number, userId?: string | null): Promise<void>;
  listImports(brandId: string): Promise<KeywordImport[]>;
};

export function articleUrl(a: { wp_link: string | null; slug: string }, brand: { website_url: string | null }): string {
  if (a.wp_link) return a.wp_link;
  const base = (brand.website_url ?? "").replace(/\/+$/, "");
  return `${base}/${a.slug}/`;
}

const BRAND_COLS = "id,slug,name,timezone,website_url,seo_suffix";

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? "Database error");
}

type PostWithTargets = PostRow & { targets: PostTargetSummary[] };

export function createSupabaseStore(admin = createAdminSupabase()): Store {
  async function brandFor(brandId: string): Promise<StoreBrand> {
    const { data } = await admin.from("brands").select(BRAND_COLS).eq("id", brandId).single();
    if (!data) throw new Error("Brand not found");
    return data;
  }
  const summarizeArticle = (row: ArticleRow, brand: StoreBrand): ArticleSummary => ({
    id: row.id, brand_id: row.brand_id, title: row.title, slug: row.slug, status: row.status, primary_keyword: row.primary_keyword, wp_link: row.wp_link,
    url: articleUrl(row, brand),
  });
  const summarizePost = (row: PostWithTargets): PostSummary => ({
    id: row.id, brand_id: row.brand_id, title: row.title, link_url: row.link_url, media: (row.media as MediaItem[] | null) ?? [], status: row.status,
    category_id: row.category_id, targets: row.targets.map((t) => ({ platform: t.platform, caption: t.caption, scheduled_at: t.scheduled_at })),
  });

  return {
    async listBrands() {
      // Hand-written Database types carry no relationships, so join in code rather than via a nested select.
      const [{ data: brands, error }, { data: conns }] = await Promise.all([
        admin.from("brands").select(BRAND_COLS).eq("active", true).order("name"),
        admin.from("brand_connections").select("brand_id,provider,status"),
      ]);
      if (error) fail(error);
      return (brands ?? []).map((b) => ({
        ...b,
        connections: Object.fromEntries((conns ?? []).filter((c) => c.brand_id === b.id).map((c) => [c.provider, c.status])),
      }));
    },
    async getBrandBySlug(slug) {
      const { data } = await admin.from("brands").select(BRAND_COLS).eq("slug", slug).maybeSingle();
      return data ?? null;
    },
    async getBrandById(id) {
      const { data } = await admin.from("brands").select(BRAND_COLS).eq("id", id).maybeSingle();
      return data ?? null;
    },
    async getGuidelines(brandId) {
      const { data, error } = await admin.from("brand_guidelines").select("kind,body_md").eq("brand_id", brandId);
      if (error) fail(error);
      const out = Object.fromEntries(GUIDELINE_KINDS.map((k) => [k.kind, ""])) as Record<GuidelineKind, string>;
      for (const row of data ?? []) out[row.kind] = row.body_md;
      return out;
    },
    async listCategories(brandId) {
      const { data, error } = await admin.from("post_categories").select("id,name,slug,target_share,description,sort_order").eq("brand_id", brandId).order("sort_order");
      if (error) fail(error);
      return (data ?? []).map((c) => ({ ...c, target_share: Number(c.target_share) }));
    },
    async listRecentCategorizedPosts(brandId) {
      const { data, error } = await admin
        .from("posts")
        .select("category_id")
        .eq("brand_id", brandId)
        .in("status", ["approved", "publishing", "published"])
        .order("created_at", { ascending: false })
        .limit(MIX_WINDOW);
      if (error) fail(error);
      return data ?? [];
    },
    async listMedia(brandId, opts = {}) {
      let q = admin.from("media_assets").select("id,public_url,alt_text,tags").eq("brand_id", brandId).order("created_at", { ascending: false }).limit(200);
      if (opts.tag) q = q.contains("tags", [opts.tag]);
      if (opts.query) q = q.or(`alt_text.ilike.%${opts.query}%,filename.ilike.%${opts.query}%`);
      const [{ data, error }, { data: arts }] = await Promise.all([q, admin.from("articles").select("featured_media").eq("brand_id", brandId).not("featured_media", "is", null)]);
      if (error) fail(error);
      const used = new Set((arts ?? []).map((a) => (a.featured_media as MediaItem | null)?.url).filter(Boolean));
      return (data ?? []).map((m) => ({ id: m.id, url: m.public_url, alt: m.alt_text, tags: m.tags, used_as_featured: used.has(m.public_url) }));
    },
    async searchWpMedia(brandId, query, perPage = 20) {
      const conn = await getConnectionWithSecret<WordpressConfig, WordpressSecret>(brandId, "wordpress");
      if (!conn) throw new Error("WordPress is not connected for this brand");
      const client = createWpClient(conn.config, conn.secret);
      const { data } = await client.get<{ id: number; source_url: string; alt_text: string; title: { rendered: string } }[]>("/wp/v2/media", {
        search: query, per_page: String(perPage), media_type: "image", _fields: "id,source_url,alt_text,title",
      });
      return data.map((m) => ({ id: m.id, source_url: m.source_url, alt_text: m.alt_text ?? "", title: m.title?.rendered ?? "" }));
    },
    async listArticles(brandId, status) {
      const brand = await brandFor(brandId);
      let q = admin.from("articles").select("*").eq("brand_id", brandId).order("updated_at", { ascending: false }).limit(200);
      q = status?.length ? q.in("status", status) : q.neq("status", "archived");
      const { data, error } = await q;
      if (error) fail(error);
      return (data ?? []).map((a) => summarizeArticle(a, brand));
    },
    async getArticle(id) {
      const { data } = await admin.from("articles").select("*").eq("id", id).maybeSingle();
      if (!data) return null;
      const brand = await brandFor(data.brand_id);
      return { ...summarizeArticle(data, brand), content_html: data.content_html, excerpt: data.excerpt, featured_media: data.featured_media as MediaItem | null, published_at: data.published_at };
    },
    async listPosts(brandId, status, limit = 20) {
      let q = admin.from("posts").select("*, targets:post_targets(platform,caption,scheduled_at)").eq("brand_id", brandId).order("created_at", { ascending: false }).limit(limit);
      if (status?.length) q = q.in("status", status);
      const { data, error } = await q;
      if (error) fail(error);
      return ((data ?? []) as unknown as PostWithTargets[]).map(summarizePost);
    },
    async getPost(id) {
      const { data } = await admin.from("posts").select("*, targets:post_targets(platform,caption,scheduled_at)").eq("id", id).maybeSingle();
      return data ? summarizePost(data as unknown as PostWithTargets) : null;
    },
    async createPost(input) {
      const { data, error } = await admin
        .from("posts")
        .insert({
          brand_id: input.brand_id, title: input.title, link_url: input.link_url, media: input.media as Json, category_id: input.category_id,
          source: input.source, recycled_from: input.recycled_from ?? null, status: "pending_approval", created_by: input.created_by ?? null,
        })
        .select("id")
        .single();
      if (error || !data) fail(error);
      const { error: tErr } = await admin
        .from("post_targets")
        .insert(input.targets.map((t) => ({ post_id: data.id, platform: t.platform, caption: t.caption, scheduled_at: t.scheduled_at })));
      if (tErr) fail(tErr);
      return { post_id: data.id };
    },
    async createArticle(input) {
      const { created_by, ...rest } = input;
      const { data, error } = await admin
        .from("articles")
        .insert({ ...rest, featured_media: rest.featured_media as Json, categories: rest.categories as Json, tags: rest.tags as Json, status: "draft", created_by: created_by ?? null })
        .select("id")
        .single();
      if (error || !data) fail(error);
      return { article_id: data.id };
    },
    async updateArticle(id, patch) {
      const { error } = await admin.from("articles").update(patch as never).eq("id", id);
      if (error) fail(error);
    },
    async listJobs(opts) {
      let q = admin.from("generation_jobs").select("*").order("created_at", { ascending: false }).limit(100);
      if (opts.brandId) q = q.eq("brand_id", opts.brandId);
      if (opts.status) q = q.eq("status", opts.status);
      if (opts.runner) q = q.eq("runner", opts.runner);
      const { data, error } = await q;
      if (error) fail(error);
      return data ?? [];
    },
    async getJob(id) {
      const { data } = await admin.from("generation_jobs").select("*").eq("id", id).maybeSingle();
      return data ?? null;
    },
    async transitionJob(id, from, patch) {
      const { data, error } = await admin.from("generation_jobs").update(patch).eq("id", id).in("status", from).select("*").maybeSingle();
      if (error) fail(error);
      return data ?? null;
    },
    async updateJob(id, patch) {
      const { error } = await admin.from("generation_jobs").update(patch).eq("id", id);
      if (error) fail(error);
    },
    async getSetting(key) {
      const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
      return data?.value ?? null;
    },
    async listSitePages(brandId, q) {
      let qq = admin.from("site_pages").select("*").eq("brand_id", brandId).order("title").limit(2000);
      if (q) qq = qq.or(`title.ilike.%${q}%,slug.ilike.%${q}%,focus_keyword.ilike.%${q}%`);
      const { data, error } = await qq;
      if (error) fail(error);
      return data ?? [];
    },
    async listKeywords(brandId, opts = {}) {
      let q = admin.from("keywords").select("*").eq("brand_id", brandId).order("keyword").limit(opts.limit ?? 5000);
      if (opts.cluster) q = q.eq("cluster", opts.cluster);
      if (opts.unclusteredOnly) q = q.is("cluster", null);
      const { data, error } = await q;
      if (error) fail(error);
      return data ?? [];
    },
    async upsertKeywords(brandId, rows, opts = {}) {
      if (rows.length === 0) return 0;
      if (opts.onlyOurFields) {
        // GSC enrichment: never overwrite imported demand data; only our_* fields, and only add rows flagged source=gsc.
        let n = 0;
        for (const r of rows) {
          const patch = { our_position: r.our_position ?? null, our_impressions: r.our_impressions ?? null, our_clicks: r.our_clicks ?? null, our_page: r.our_page ?? null, refreshed_at: new Date().toISOString() };
          const { data } = await admin.from("keywords").update(patch).eq("brand_id", brandId).eq("keyword", r.keyword).select("id");
          if (data?.length) n += data.length;
          else if (r.source === "gsc") {
            const { error } = await admin.from("keywords").insert({ brand_id: brandId, keyword: r.keyword, source: "gsc", ...patch });
            if (!error) n++;
          }
        }
        return n;
      }
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500).map((r) => ({ brand_id: brandId, ...r, refreshed_at: new Date().toISOString() }));
        const { error } = await admin.from("keywords").upsert(batch as never, { onConflict: "brand_id,keyword" });
        if (error) fail(error);
      }
      return rows.length;
    },
    async setClusters(brandId, assignments) {
      let n = 0;
      for (const a of assignments) {
        const { data } = await admin.from("keywords").update({ cluster: a.cluster }).eq("brand_id", brandId).eq("keyword", a.keyword).select("id");
        n += data?.length ?? 0;
      }
      return n;
    },
    async searchProjects(brandId, opts) {
      let q = admin.from("projects").select("*").eq("brand_id", brandId).order("imported_at", { ascending: false }).limit(opts.limit ?? 20);
      if (opts.category) q = q.eq("category", opts.category);
      if (opts.state) q = q.eq("state", opts.state.toUpperCase());
      if (opts.q) q = q.textSearch("search", opts.q, { type: "websearch", config: "english" });
      const { data, error } = await q;
      if (error) fail(error);
      return data ?? [];
    },
    async listArticleKeywordRefs(brandId) {
      const { data, error } = await admin.from("articles").select("id,title,slug,status,primary_keyword,secondary_keywords,wp_link").eq("brand_id", brandId).neq("status", "archived");
      if (error) fail(error);
      return data ?? [];
    },
    async listGscQueryPages(brandId, days) {
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await admin.from("metrics_daily").select("dim,metrics").eq("brand_id", brandId).eq("source", "gsc_query_page").gte("date", since).limit(20000);
      if (error) fail(error);
      const agg = new Map<string, { position: number; clicks: number; imps: number }>();
      for (const r of data ?? []) {
        const m = r.metrics as Record<string, number>;
        const a = agg.get(r.dim) ?? { position: 0, clicks: 0, imps: 0 };
        a.clicks += m.clicks ?? 0;
        a.position += (m.position ?? 0) * (m.impressions ?? 0);
        a.imps += m.impressions ?? 0;
        agg.set(r.dim, a);
      }
      return [...agg].map(([dim, a]) => {
        const [query, page] = dim.split("|", 2);
        return { query, page, position: a.imps ? a.position / a.imps : 0, clicks: a.clicks };
      });
    },
    async logImport(brandId, kind, detail, rows, userId = null) {
      await admin.from("keyword_imports").insert({ brand_id: brandId, kind, detail, rows, created_by: userId });
    },
    async listImports(brandId) {
      const { data, error } = await admin.from("keyword_imports").select("*").eq("brand_id", brandId).order("created_at", { ascending: false }).limit(50);
      if (error) fail(error);
      return data ?? [];
    },
  };
}
