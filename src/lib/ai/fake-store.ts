// In-memory Store used by tool, brief, runner and MCP tests. Never imported by app code.
import { vi } from "vitest";
import type { Store, StoreJob, PostSummary, ArticleFull, StoreMedia, SitePage, Keyword, Project, KeywordImport, ArticleKeywordRef, PinBoardInfo } from "./store";
import type { CategoryLike } from "./content-mix";

export const BRAND = { id: "b1", slug: "acme", name: "Acme", timezone: "America/Los_Angeles", website_url: "https://acme.com", seo_suffix: "| Acme" };

type Seed = { jobs?: StoreJob[]; posts?: PostSummary[]; articles?: ArticleFull[]; media?: StoreMedia[]; categories?: CategoryLike[]; sitePages?: SitePage[]; keywords?: Keyword[]; projects?: Project[]; articleRefs?: ArticleKeywordRef[]; gscQueryPages?: { query: string; page: string; position: number; clicks: number }[]; imports?: KeywordImport[]; boards?: PinBoardInfo[] };
export type FakeStore = Store & { jobs: StoreJob[]; keywords: Keyword[]; imports: KeywordImport[]; created: { posts: unknown[]; articles: unknown[]; pins: unknown[] } };

export function fakeStore(over: Partial<Store> & Seed = {}): FakeStore {
  const { jobs = [], posts = [], articles = [], media = [], categories = [], sitePages = [], keywords = [], projects = [], articleRefs = [], gscQueryPages = [], imports = [], boards = [], ...overrides } = over;
  const created = { posts: [] as unknown[], articles: [] as unknown[], pins: [] as unknown[] };
  const base: Store = {
    listBrands: vi.fn(async () => [{ ...BRAND, connections: { wordpress: "connected" } }]),
    getBrandBySlug: vi.fn(async (slug) => (slug === BRAND.slug ? BRAND : null)),
    getBrandById: vi.fn(async (id) => (id === BRAND.id ? BRAND : null)),
    getGuidelines: vi.fn(async () => ({ social_style: "Be upbeat.", social_post_spec: "Hook, body, CTA.", blog_style: "Helpful.", blog_post_spec: "H2s.", pin_spec: "" })),
    listCategories: vi.fn(async () => categories),
    listRecentCategorizedPosts: vi.fn(async () => posts.map((p) => ({ category_id: p.category_id }))),
    listMedia: vi.fn(async () => media),
    searchWpMedia: vi.fn(async () => []),
    listArticles: vi.fn(async () => articles),
    getArticle: vi.fn(async (id) => articles.find((a) => a.id === id) ?? null),
    listPosts: vi.fn(async () => posts),
    getPost: vi.fn(async (id) => posts.find((p) => p.id === id) ?? null),
    createPost: vi.fn(async (input) => {
      created.posts.push(input);
      return { post_id: "11111111-1111-4111-8111-111111111111" };
    }),
    createArticle: vi.fn(async (input) => {
      created.articles.push(input);
      return { article_id: "22222222-2222-4222-8222-222222222222" };
    }),
    updateArticle: vi.fn(async () => {}),
    listJobs: vi.fn(async (o) => jobs.filter((j) => (!o.status || j.status === o.status) && (!o.runner || j.runner === o.runner) && (!o.brandId || j.brand_id === o.brandId))),
    getJob: vi.fn(async (id) => jobs.find((j) => j.id === id) ?? null),
    transitionJob: vi.fn(async (id, from, patch) => {
      const j = jobs.find((x) => x.id === id);
      if (!j || !from.includes(j.status)) return null;
      Object.assign(j, patch);
      return j;
    }),
    updateJob: vi.fn(async (id, patch) => {
      const j = jobs.find((x) => x.id === id);
      if (j) Object.assign(j, patch);
    }),
    getSetting: vi.fn(async () => null),
    listSitePages: vi.fn(async (_b, q) => (q ? sitePages.filter((p) => p.title.toLowerCase().includes(q.toLowerCase())) : sitePages)),
    listKeywords: vi.fn(async (_b, o = {}) => keywords.filter((k) => (!o.cluster || k.cluster === o.cluster) && (!o.unclusteredOnly || !k.cluster)).slice(0, o.limit ?? 5000)),
    upsertKeywords: vi.fn(async (_b, rows) => {
      for (const r of rows) {
        const cur = keywords.find((k) => k.keyword === r.keyword);
        if (cur) Object.assign(cur, r);
        else keywords.push({ id: `k${keywords.length + 1}`, brand_id: BRAND.id, cluster: null, volume: null, difficulty: null, intent: null, competitor: null, competitor_position: null, our_position: null, our_impressions: null, our_clicks: null, our_page: null, source: "csv", notes: null, imported_at: new Date().toISOString(), refreshed_at: null, ...r });
      }
      return rows.length;
    }),
    setClusters: vi.fn(async (_b, a) => { let n = 0; for (const x of a) { const k = keywords.find((y) => y.keyword === x.keyword); if (k) { k.cluster = x.cluster; n++; } } return n; }),
    searchProjects: vi.fn(async (_b, o) => projects.filter((p) => (!o.q || (p.title + " " + (p.description ?? "")).toLowerCase().includes(o.q.toLowerCase())) && (!o.category || p.category === o.category) && (!o.state || p.state === o.state.toUpperCase())).slice(0, o.limit ?? 20)),
    listArticleKeywordRefs: vi.fn(async () => articleRefs),
    listGscQueryPages: vi.fn(async () => gscQueryPages),
    logImport: vi.fn(async (_b, kind, detail, rows) => { imports.push({ id: `i${imports.length + 1}`, brand_id: BRAND.id, kind, detail, rows, created_by: null, created_at: new Date().toISOString() }); }),
    listImports: vi.fn(async () => imports),
    listPinBoards: vi.fn(async () => boards),
    createPin: vi.fn(async (input) => { created.pins.push(input); return { pin_id: "77777777-7777-4777-8777-777777777777" }; }),
    listRecentPinTitles: vi.fn(async () => (created.pins as { title: string }[]).map((p) => p.title)),
    listUnpinned: vi.fn(async (_b, kind) => (kind === "media" ? media.map((m) => ({ id: m.id, title: m.alt ?? m.id, url: null, image_url: m.url })) : projects.map((p) => ({ id: p.id, title: p.title, url: p.url, image_url: ((p.images as { url: string }[]) ?? [])[0]?.url ?? null })))),
    getProject: vi.fn(async (id) => projects.find((p) => p.id === id) ?? null),
    getMediaAsset: vi.fn(async (id) => media.find((m) => m.id === id) ?? null),
  };
  return Object.assign(base, overrides, { jobs, keywords, imports, created });
}

export function job(over: Partial<StoreJob> = {}): StoreJob {
  return {
    id: "33333333-3333-4333-8333-333333333333", brand_id: BRAND.id, type: "caption", status: "queued", runner: "in_app",
    input: { post_id: "44444444-4444-4444-8444-444444444444" }, result: null, error: null, post_id: null, article_id: null, claimed_by: null,
    claimed_at: null, started_at: null, finished_at: null, attempts: 0, model: null, input_tokens: null, output_tokens: null, created_by: null,
    created_at: "2026-09-13T00:00:00Z", updated_at: "2026-09-13T00:00:00Z", ...over,
  };
}
