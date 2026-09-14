// In-memory Store used by tool, brief, runner and MCP tests. Never imported by app code.
import { vi } from "vitest";
import type { Store, StoreJob, PostSummary, ArticleFull, StoreMedia } from "./store";
import type { CategoryLike } from "./content-mix";

export const BRAND = { id: "b1", slug: "acme", name: "Acme", timezone: "America/Los_Angeles", website_url: "https://acme.com", seo_suffix: "| Acme" };

type Seed = { jobs?: StoreJob[]; posts?: PostSummary[]; articles?: ArticleFull[]; media?: StoreMedia[]; categories?: CategoryLike[] };
export type FakeStore = Store & { jobs: StoreJob[]; created: { posts: unknown[]; articles: unknown[] } };

export function fakeStore(over: Partial<Store> & Seed = {}): FakeStore {
  const { jobs = [], posts = [], articles = [], media = [], categories = [], ...overrides } = over;
  const created = { posts: [] as unknown[], articles: [] as unknown[] };
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
  };
  return Object.assign(base, overrides, { jobs, created });
}

export function job(over: Partial<StoreJob> = {}): StoreJob {
  return {
    id: "33333333-3333-4333-8333-333333333333", brand_id: BRAND.id, type: "caption", status: "queued", runner: "in_app",
    input: { post_id: "44444444-4444-4444-8444-444444444444" }, result: null, error: null, post_id: null, article_id: null, claimed_by: null,
    claimed_at: null, started_at: null, finished_at: null, attempts: 0, model: null, input_tokens: null, output_tokens: null, created_by: null,
    created_at: "2026-09-13T00:00:00Z", updated_at: "2026-09-13T00:00:00Z", ...over,
  };
}
