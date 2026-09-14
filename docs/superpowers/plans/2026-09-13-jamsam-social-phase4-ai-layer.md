# JamSam Social Phase 4: AI Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude writes captions, articles, promo posts, and rewrites for a brand from one `generation_jobs` queue, either in-app (Claude API) or via an MCP server, sharing one tool layer; plus per-brand content-mix tracking.

**Architecture:** A `Store` interface (`src/lib/ai/store.ts`) wraps every DB/WP operation the AI layer needs, implemented once over the Supabase admin client. Tools (`src/lib/ai/tools/`) are pure functions over `ToolCtx { store, actor }` with zod input schemas. Two adapters expose them: the MCP route registers them on an `McpServer`; the in-app runner (`src/lib/ai/runner.ts`) turns them into Anthropic tool definitions and drives a manual tool-use loop until the job's terminal tool succeeds. Jobs are kicked off with `after()` and backstopped by `/api/cron/jobs`.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + pg_cron), `@anthropic-ai/sdk` ^0.125, `@modelcontextprotocol/sdk` ^1.30 (Web-standard streamable HTTP, stateless), zod 4 (`z.toJSONSchema`), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-jamsam-social-phase4-ai-layer-design.md`

## Global Constraints

- Read `node_modules/next/dist/docs/` before using a Next API you have not used in this repo; `after` is documented at `01-app/03-api-reference/04-functions/after.md`.
- Server Components must not pass event handlers to DOM elements (Phase 3 regression). Anything interactive is a `"use client"` component.
- Every content table carries `brand_id`; RLS policy is "authenticated full access"; the service role is used only in server code.
- Secrets never reach the browser: `ANTHROPIC_API_KEY` and `MCP_TOKEN` are read only via `src/lib/env.ts`.
- Model default `claude-opus-5`, selectable `claude-sonnet-5`; model IDs are used exactly as written, no date suffixes. Thinking is left at the model default (adaptive on Opus 5); no `budget_tokens`.
- Brand slugs identify brands in every tool. Job `input`/`result` shapes are exactly the spec table.
- Hard caption rules (enforced in code): no em/en dashes (`—`, `–`), never the word "actually", at least one apostrophe contraction per 40 words, IG ≤ 2,200 chars, FB ≤ 5,000 chars.
- Nothing is written to `posts`/`articles` except by the terminal tool of a job.
- Commit after every task with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01GgfmnucJWw8Do79kHXzcL5` trailers.
- Run `npm run typecheck && npm run lint && npm test` before every commit.

---

### Task 1: Migration, types, dependencies, env

**Files:**
- Create: `supabase/migrations/0004_ai_layer.sql`
- Modify: `src/lib/database.types.ts`
- Modify: `src/lib/env.ts`
- Modify: `vitest.config.ts` (env block)
- Modify: `package.json` (deps)
- Modify: `.env.local` (local only, not committed), Vercel env

**Interfaces:**
- Produces: `Database["public"]["Tables"]["generation_jobs"]`, `["post_categories"]`, `posts.category_id`, enums `job_type | job_status | job_runner`, `env.ANTHROPIC_API_KEY`, `env.MCP_TOKEN`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0004_ai_layer.sql
create type job_type   as enum ('caption','article','promo','rewrite');
create type job_status as enum ('queued','claimed','running','completed','failed');
create type job_runner as enum ('in_app','mcp');

create table generation_jobs (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  type          job_type not null,
  status        job_status not null default 'queued',
  runner        job_runner not null default 'in_app',
  input         jsonb not null,
  result        jsonb,
  error         text,
  post_id       uuid references posts(id) on delete set null,
  article_id    uuid references articles(id) on delete set null,
  claimed_by    text,
  claimed_at    timestamptz,
  started_at    timestamptz,
  finished_at   timestamptz,
  attempts      int not null default 0,
  model         text,
  input_tokens  int,
  output_tokens int,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index generation_jobs_status_idx on generation_jobs (status, created_at);
create index generation_jobs_brand_idx  on generation_jobs (brand_id, created_at desc);
create trigger generation_jobs_updated_at before update on generation_jobs for each row execute function set_updated_at();

create table post_categories (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  name         text not null,
  slug         text not null,
  target_share numeric(4,3) not null check (target_share >= 0 and target_share <= 1),
  description  text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  unique (brand_id, slug)
);
alter table posts add column category_id uuid references post_categories(id) on delete set null;

alter table generation_jobs enable row level security;
alter table post_categories enable row level security;
create policy "authenticated full access" on generation_jobs for all to authenticated using (true) with check (true);
create policy "authenticated full access" on post_categories for all to authenticated using (true) with check (true);

-- Backstop tick for in-app jobs (see /api/cron/jobs)
select cron.schedule(
  'jamsam-jobs-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select value from public.app_settings where key = 'cron_url') || '/api/cron/jobs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select value from public.app_settings where key = 'cron_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 2: Add the hand-written types**

In `src/lib/database.types.ts`, add after `ArticleMediaMapRow`:

```ts
type GenerationJobRow = {
  id: string; brand_id: string; type: "caption" | "article" | "promo" | "rewrite";
  status: "queued" | "claimed" | "running" | "completed" | "failed"; runner: "in_app" | "mcp";
  input: Json; result: Json | null; error: string | null; post_id: string | null; article_id: string | null;
  claimed_by: string | null; claimed_at: string | null; started_at: string | null; finished_at: string | null;
  attempts: number; model: string | null; input_tokens: number | null; output_tokens: number | null;
  created_by: string | null; created_at: string; updated_at: string;
};
type PostCategoryRow = {
  id: string; brand_id: string; name: string; slug: string; target_share: number; description: string | null;
  sort_order: number; created_at: string;
};
```

Add `category_id: string | null;` to `PostRow`. Add to `Tables`:

```ts
      generation_jobs: Table<GenerationJobRow, "brand_id" | "type" | "input">;
      post_categories: Table<PostCategoryRow, "brand_id" | "name" | "slug" | "target_share">;
```

Add to `Enums`:

```ts
      job_type: GenerationJobRow["type"];
      job_status: GenerationJobRow["status"];
      job_runner: GenerationJobRow["runner"];
```

- [ ] **Step 3: Env**

In `src/lib/env.ts` add to the schema and the `parseEnv` call:

```ts
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  MCP_TOKEN: z.string().min(32, "MCP_TOKEN must be at least 32 chars (openssl rand -base64 32)"),
```

```ts
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  MCP_TOKEN: process.env.MCP_TOKEN,
```

In `vitest.config.ts` `test.env` add `ANTHROPIC_API_KEY: "test-anthropic-key", MCP_TOKEN: "test-mcp-token-0000000000000000000000"`.

Add to `.env.local` (ask the user for the Anthropic key; generate the token):

```bash
echo "MCP_TOKEN=$(openssl rand -base64 32)" >> .env.local
```

Set both on Vercel: `npx vercel env add ANTHROPIC_API_KEY production` and `npx vercel env add MCP_TOKEN production` (and `preview`).

- [ ] **Step 4: Dependencies and migration**

```bash
npm i @anthropic-ai/sdk@^0.125 @modelcontextprotocol/sdk@^1.30
npx supabase db push --db-url "$SUPABASE_DB_URL"   # same DB-URL path used in Phases 1–3
```

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: pass (env test in `src/lib/env.test.ts` if present still passes; otherwise no test changes).

```bash
git add supabase/migrations/0004_ai_layer.sql src/lib/database.types.ts src/lib/env.ts vitest.config.ts package.json package-lock.json
git commit -m "feat(db): generation_jobs, post_categories, AI env"
```

---

### Task 2: Job schemas, caption validator, content-mix maths (pure)

**Files:**
- Create: `src/lib/ai/schemas.ts`, `src/lib/ai/schemas.test.ts`
- Create: `src/lib/ai/captions.ts`, `src/lib/ai/captions.test.ts`
- Create: `src/lib/ai/content-mix.ts`, `src/lib/ai/content-mix.test.ts`

**Interfaces:**
- Produces:
  - `JobType`, `JobStatus`, `JobRunner` (from Database enums); `JOB_INPUT: Record<JobType, z.ZodType>`; `JOB_RESULT: Record<JobType, z.ZodType>`; `parseJobInput(type, raw)`; `parseJobResult(type, raw)`; input/result TS types `CaptionInput`, `ArticleInput`, `PromoInput`, `RewriteInput`, `CaptionResult`, …
  - `validateCaption(platform: "facebook" | "instagram", text: string): string[]` (list of violations, empty = ok)
  - `computeContentMix(categories: CategoryLike[], posts: { category_id: string | null }[]): ContentMix`

- [ ] **Step 1: Write failing schema tests**

```ts
// src/lib/ai/schemas.test.ts
import { describe, it, expect } from "vitest";
import { parseJobInput, parseJobResult } from "@/lib/ai/schemas";

describe("job schemas", () => {
  it("accepts a caption input and rejects a missing post_id", () => {
    expect(parseJobInput("caption", { post_id: "3f5c1c1e-1b9a-4c1e-9a1e-1b9a4c1e9a1e" }).success).toBe(true);
    expect(parseJobInput("caption", {}).success).toBe(false);
  });
  it("defaults article decision to new and trims topic", () => {
    const r = parseJobInput("article", { topic: "  Deck staining  " });
    expect(r.success && r.data).toEqual({ topic: "Deck staining", decision: "new", secondary_keywords: [] });
  });
  it("validates caption results", () => {
    expect(parseJobResult("caption", { captions: { facebook: "a", instagram: "b" } }).success).toBe(true);
    expect(parseJobResult("caption", { captions: { facebook: "a" } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/ai/schemas.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement schemas**

```ts
// src/lib/ai/schemas.ts
import { z } from "zod";
import type { Database } from "@/lib/database.types";

export type JobType = Database["public"]["Enums"]["job_type"];
export type JobStatus = Database["public"]["Enums"]["job_status"];
export type JobRunner = Database["public"]["Enums"]["job_runner"];
export const JOB_TYPES: JobType[] = ["caption", "article", "promo", "rewrite"];

const uuid = z.string().uuid();

export const captionInputSchema = z.object({ post_id: uuid });
export const articleInputSchema = z.object({
  topic: z.string().trim().min(3).max(300),
  primary_keyword: z.string().trim().min(1).max(120).optional(),
  secondary_keywords: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  decision: z.enum(["new", "rewrite", "optimize"]).default("new"),
  notes: z.string().trim().max(4000).optional(),
});
export const promoInputSchema = z.object({ article_id: uuid, scheduled_after: z.string().datetime({ offset: true }).optional() });
export const rewriteInputSchema = z.object({ post_id: uuid });

export const captionsSchema = z.object({ facebook: z.string().min(1), instagram: z.string().min(1) });
export const captionResultSchema = z.object({ captions: captionsSchema, category_slug: z.string().optional() });
export const articleResultSchema = z.object({ article_id: uuid });
export const postResultSchema = z.object({ post_id: uuid });

export const JOB_INPUT = { caption: captionInputSchema, article: articleInputSchema, promo: promoInputSchema, rewrite: rewriteInputSchema } as const;
export const JOB_RESULT = { caption: captionResultSchema, article: articleResultSchema, promo: postResultSchema, rewrite: postResultSchema } as const;

export type CaptionInput = z.infer<typeof captionInputSchema>;
export type ArticleInput = z.infer<typeof articleInputSchema>;
export type PromoInput = z.infer<typeof promoInputSchema>;
export type RewriteInput = z.infer<typeof rewriteInputSchema>;
export type JobInput = { caption: CaptionInput; article: ArticleInput; promo: PromoInput; rewrite: RewriteInput };
export type CaptionResult = z.infer<typeof captionResultSchema>;

export function parseJobInput(type: JobType, raw: unknown) {
  return JOB_INPUT[type].safeParse(raw);
}
export function parseJobResult(type: JobType, raw: unknown) {
  return JOB_RESULT[type].safeParse(raw);
}
/** The tool whose successful call ends a job of this type. */
export const TERMINAL_TOOL: Record<JobType, string> = { caption: "submit_captions", article: "create_article", promo: "create_post", rewrite: "create_post" };
```

- [ ] **Step 4: Caption validator tests + implementation**

```ts
// src/lib/ai/captions.test.ts
import { describe, it, expect } from "vitest";
import { validateCaption } from "@/lib/ai/captions";

describe("validateCaption", () => {
  it("passes a clean caption", () => {
    expect(validateCaption("instagram", "We're back on site today and it's looking great 🔥")).toEqual([]);
  });
  it("flags em and en dashes", () => {
    expect(validateCaption("facebook", "We're here — and it's ready")).toContain("Contains an em dash (—)");
    expect(validateCaption("facebook", "We're here – and it's ready")).toContain("Contains an en dash (–)");
  });
  it("flags the word actually (case-insensitive, whole word)", () => {
    expect(validateCaption("facebook", "It's Actually done")).toContain('Uses the word "actually"');
    expect(validateCaption("facebook", "It's factually done")).toEqual([]);
  });
  it("requires contractions in longer captions", () => {
    const long = Array(45).fill("word").join(" ");
    expect(validateCaption("facebook", long)).toContain("No contractions found (use we're, it's, you'll …)");
  });
  it("enforces platform lengths", () => {
    expect(validateCaption("instagram", "it's " + "x".repeat(2200))).toContain("Instagram captions must be ≤ 2,200 characters");
    expect(validateCaption("facebook", "it's " + "x".repeat(5000))).toContain("Facebook captions must be ≤ 5,000 characters");
  });
});
```

```ts
// src/lib/ai/captions.ts
export type CaptionPlatform = "facebook" | "instagram";
const LIMITS: Record<CaptionPlatform, { max: number; label: string }> = {
  instagram: { max: 2200, label: "Instagram captions must be ≤ 2,200 characters" },
  facebook: { max: 5000, label: "Facebook captions must be ≤ 5,000 characters" },
};
const CONTRACTION = /\b\w+'(re|s|ll|ve|d|t|m)\b/i;

/** Hard brand rules. Returns violations; empty means OK. Enforced in code, not just prompts. */
export function validateCaption(platform: CaptionPlatform, text: string): string[] {
  const out: string[] = [];
  if (text.includes("—")) out.push("Contains an em dash (—)");
  if (text.includes("–")) out.push("Contains an en dash (–)");
  if (/\bactually\b/i.test(text)) out.push('Uses the word "actually"');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words >= 40 && !CONTRACTION.test(text)) out.push("No contractions found (use we're, it's, you'll …)");
  if (text.length > LIMITS[platform].max) out.push(LIMITS[platform].label);
  return out;
}
```

- [ ] **Step 5: Content-mix tests + implementation**

```ts
// src/lib/ai/content-mix.test.ts
import { describe, it, expect } from "vitest";
import { computeContentMix } from "@/lib/ai/content-mix";

const cats = [
  { id: "a", name: "Projects", slug: "projects", target_share: 0.5, description: null, sort_order: 0 },
  { id: "b", name: "Tips", slug: "tips", target_share: 0.3, description: null, sort_order: 1 },
  { id: "c", name: "Credibility", slug: "credibility", target_share: 0.2, description: null, sort_order: 2 },
];

describe("computeContentMix", () => {
  it("returns empty when the brand has no categories", () => {
    expect(computeContentMix([], [{ category_id: null }])).toEqual({ window: 20, total: 1, categories: [], favour_next: null });
  });
  it("computes actual shares over the window, counting uncategorized in the denominator", () => {
    const posts = [{ category_id: "a" }, { category_id: "a" }, { category_id: "b" }, { category_id: null }];
    const mix = computeContentMix(cats, posts);
    expect(mix.total).toBe(4);
    expect(mix.categories.find((c) => c.slug === "projects")).toMatchObject({ count: 2, actual_share: 0.5 });
    expect(mix.categories.find((c) => c.slug === "tips")).toMatchObject({ count: 1, actual_share: 0.25 });
    expect(mix.categories.find((c) => c.slug === "credibility")).toMatchObject({ count: 0, actual_share: 0 });
  });
  it("favours the most under-served category, ties broken by sort_order", () => {
    expect(computeContentMix(cats, [{ category_id: "a" }, { category_id: "a" }]).favour_next).toBe("tips"); // tips -0.3, credibility -0.2
    expect(computeContentMix(cats, []).favour_next).toBe("projects"); // all at deficit = target; largest target wins
  });
  it("only considers the last 20 posts", () => {
    const posts = [...Array(20).fill({ category_id: "b" }), ...Array(10).fill({ category_id: "a" })];
    expect(computeContentMix(cats, posts).total).toBe(20);
    expect(computeContentMix(cats, posts).categories.find((c) => c.slug === "projects")?.count).toBe(0);
  });
});
```

```ts
// src/lib/ai/content-mix.ts
export const MIX_WINDOW = 20;
export type CategoryLike = { id: string; name: string; slug: string; target_share: number; description: string | null; sort_order: number };
export type ContentMix = {
  window: number;
  total: number;
  categories: { id: string; name: string; slug: string; description: string | null; target_share: number; actual_share: number; count: number }[];
  favour_next: string | null;
};

/** posts must be ordered newest first; only the first MIX_WINDOW are considered. */
export function computeContentMix(categories: CategoryLike[], posts: { category_id: string | null }[]): ContentMix {
  const recent = posts.slice(0, MIX_WINDOW);
  const total = recent.length;
  if (categories.length === 0) return { window: MIX_WINDOW, total, categories: [], favour_next: null };
  const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order);
  const rows = sorted.map((c) => {
    const count = recent.filter((p) => p.category_id === c.id).length;
    return { id: c.id, name: c.name, slug: c.slug, description: c.description, target_share: Number(c.target_share), actual_share: total ? count / total : 0, count };
  });
  let best = rows[0];
  for (const r of rows) if (r.target_share - r.actual_share > best.target_share - best.actual_share) best = r;
  return { window: MIX_WINDOW, total, categories: rows, favour_next: best.slug };
}
```

- [ ] **Step 6: Run all three test files, then commit**

Run: `npx vitest run src/lib/ai`
Expected: all pass.

```bash
git add src/lib/ai
git commit -m "feat(ai): job schemas, caption validator, content-mix maths"
```

---

### Task 3: Store interface over Supabase + WordPress

**Files:**
- Create: `src/lib/ai/store.ts`
- Create: `src/lib/ai/store.test.ts` (only the pure helpers: `articleUrl`, `usedAsFeatured`)
- Create: `src/lib/ai/fake-store.ts` (test helper, exported for later tasks' tests)

**Interfaces:**
- Produces `Store` — every method the tools and runner need. Later tasks call **only** these names:

```ts
export type StoreBrand = { id: string; slug: string; name: string; timezone: string; website_url: string | null; seo_suffix: string | null };
export type StoreJob = Database["public"]["Tables"]["generation_jobs"]["Row"];
export type Store = {
  listBrands(): Promise<(StoreBrand & { connections: Record<string, string> })[]>;
  getBrandBySlug(slug: string): Promise<StoreBrand | null>;
  getBrandById(id: string): Promise<StoreBrand | null>;
  getGuidelines(brandId: string): Promise<Record<GuidelineKind, string>>;
  listCategories(brandId: string): Promise<CategoryLike[]>;
  listRecentCategorizedPosts(brandId: string): Promise<{ category_id: string | null }[]>; // newest first, approved/publishing/published, limit MIX_WINDOW
  listMedia(brandId: string, opts?: { tag?: string; query?: string }): Promise<{ id: string; url: string; alt: string | null; tags: string[]; used_as_featured: boolean }[]>;
  searchWpMedia(brandId: string, query: string, perPage?: number): Promise<{ id: number; source_url: string; alt_text: string; title: string }[]>;
  listArticles(brandId: string, status?: ArticleStatus[]): Promise<ArticleSummary[]>;
  getArticle(id: string): Promise<(ArticleSummary & { content_html: string; excerpt: string | null; featured_media: MediaItem | null; published_at: string | null }) | null>;
  listPosts(brandId: string, status?: PostStatus[], limit?: number): Promise<PostSummary[]>;
  getPost(id: string): Promise<PostSummary | null>;
  createPost(input: CreatePostInput): Promise<{ post_id: string }>;
  createArticle(input: CreateArticleInput): Promise<{ article_id: string }>;
  updateArticle(id: string, patch: Partial<CreateArticleInput>): Promise<void>;
  listJobs(opts: { brandId?: string; status?: JobStatus; runner?: JobRunner }): Promise<StoreJob[]>;
  getJob(id: string): Promise<StoreJob | null>;
  transitionJob(id: string, from: JobStatus[], patch: Partial<StoreJob>): Promise<StoreJob | null>; // atomic update … where status in from; null if 0 rows
  updateJob(id: string, patch: Partial<StoreJob>): Promise<void>;
  getSetting(key: string): Promise<string | null>;
};
export type ArticleSummary = { id: string; brand_id: string; title: string; slug: string; status: ArticleStatus; url: string; primary_keyword: string | null; wp_link: string | null };
export type PostSummary = { id: string; brand_id: string; title: string; link_url: string | null; media: MediaItem[]; status: PostStatus; category_id: string | null; targets: { platform: "facebook" | "instagram"; caption: string; scheduled_at: string | null }[] };
export type CreatePostInput = { brand_id: string; title: string; link_url: string | null; media: MediaItem[]; category_id: string | null; source: "ai" | "recycled"; recycled_from?: string | null; created_by?: string | null; targets: { platform: "facebook" | "instagram"; caption: string; scheduled_at: string | null }[] };
export type CreateArticleInput = { brand_id: string; title: string; slug: string; content_html: string; excerpt: string | null; seo_title: string | null; meta_description: string | null; primary_keyword: string | null; secondary_keywords: string[]; featured_media: MediaItem | null; categories: TermRef[]; tags: TermRef[]; decision: "new" | "rewrite" | "optimize"; rationale: string | null; source: "ai"; created_by?: string | null };
export function createSupabaseStore(admin = createAdminSupabase()): Store;
export function articleUrl(a: { wp_link: string | null; slug: string }, brand: { website_url: string | null }): string;
```

- [ ] **Step 1: Tests for the pure helpers**

```ts
// src/lib/ai/store.test.ts
import { describe, it, expect } from "vitest";
import { articleUrl } from "@/lib/ai/store";

describe("articleUrl", () => {
  it("prefers wp_link", () => {
    expect(articleUrl({ wp_link: "https://x.com/a/", slug: "a" }, { website_url: "https://x.com" })).toBe("https://x.com/a/");
  });
  it("falls back to website/slug/ and tolerates a trailing slash", () => {
    expect(articleUrl({ wp_link: null, slug: "a" }, { website_url: "https://x.com/" })).toBe("https://x.com/a/");
    expect(articleUrl({ wp_link: null, slug: "a" }, { website_url: null })).toBe("/a/");
  });
});
```

- [ ] **Step 2: Implement `store.ts`**

```ts
// src/lib/ai/store.ts
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
export type StoreBrand = { id: string; slug: string; name: string; timezone: string; website_url: string | null; seo_suffix: string | null };
export type StoreJob = Database["public"]["Tables"]["generation_jobs"]["Row"];
export type ArticleSummary = { id: string; brand_id: string; title: string; slug: string; status: ArticleStatus; url: string; primary_keyword: string | null; wp_link: string | null };
export type ArticleFull = ArticleSummary & { content_html: string; excerpt: string | null; featured_media: MediaItem | null; published_at: string | null };
export type PostTargetSummary = { platform: "facebook" | "instagram"; caption: string; scheduled_at: string | null };
export type PostSummary = { id: string; brand_id: string; title: string; link_url: string | null; media: MediaItem[]; status: PostStatus; category_id: string | null; targets: PostTargetSummary[] };
export type CreatePostInput = { brand_id: string; title: string; link_url: string | null; media: MediaItem[]; category_id: string | null; source: "ai" | "recycled"; recycled_from?: string | null; created_by?: string | null; targets: PostTargetSummary[] };
export type CreateArticleInput = {
  brand_id: string; title: string; slug: string; content_html: string; excerpt: string | null; seo_title: string | null; meta_description: string | null;
  primary_keyword: string | null; secondary_keywords: string[]; featured_media: MediaItem | null; categories: TermRef[]; tags: TermRef[];
  decision: "new" | "rewrite" | "optimize"; rationale: string | null; source: "ai"; created_by?: string | null;
};
export type StoreMedia = { id: string; url: string; alt: string | null; tags: string[]; used_as_featured: boolean };
export type WpMediaHit = { id: number; source_url: string; alt_text: string; title: string };

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
  transitionJob(id: string, from: JobStatus[], patch: Partial<StoreJob>): Promise<StoreJob | null>;
  updateJob(id: string, patch: Partial<StoreJob>): Promise<void>;
  getSetting(key: string): Promise<string | null>;
};

export function articleUrl(a: { wp_link: string | null; slug: string }, brand: { website_url: string | null }): string {
  if (a.wp_link) return a.wp_link;
  const base = (brand.website_url ?? "").replace(/\/+$/, "");
  return `${base}/${a.slug}/`;
}

const BRAND_COLS = "id,slug,name,timezone,website_url,seo_suffix";
const ARTICLE_COLS = "id,brand_id,title,slug,status,primary_keyword,wp_link";

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? "Database error");
}

export function createSupabaseStore(admin = createAdminSupabase()): Store {
  async function brandFor(brandId: string): Promise<StoreBrand> {
    const { data } = await admin.from("brands").select(BRAND_COLS).eq("id", brandId).single();
    if (!data) throw new Error("Brand not found");
    return data;
  }
  const summarizeArticle = (row: Database["public"]["Tables"]["articles"]["Row"], brand: StoreBrand): ArticleSummary => ({
    id: row.id, brand_id: row.brand_id, title: row.title, slug: row.slug, status: row.status, primary_keyword: row.primary_keyword, wp_link: row.wp_link,
    url: articleUrl(row, brand),
  });
  const summarizePost = (row: Database["public"]["Tables"]["posts"]["Row"] & { targets: { platform: "facebook" | "instagram"; caption: string; scheduled_at: string | null }[] }): PostSummary => ({
    id: row.id, brand_id: row.brand_id, title: row.title, link_url: row.link_url, media: (row.media as MediaItem[] | null) ?? [], status: row.status,
    category_id: row.category_id, targets: row.targets.map((t) => ({ platform: t.platform, caption: t.caption, scheduled_at: t.scheduled_at })),
  });

  return {
    async listBrands() {
      const { data, error } = await admin.from("brands").select(`${BRAND_COLS}, brand_connections(provider,status)`).eq("active", true).order("name");
      if (error) fail(error);
      return (data ?? []).map(({ brand_connections, ...b }) => ({
        ...b,
        connections: Object.fromEntries((brand_connections as { provider: string; status: string }[]).map((c) => [c.provider, c.status])),
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
        .from("posts").select("category_id").eq("brand_id", brandId).in("status", ["approved", "publishing", "published"])
        .order("created_at", { ascending: false }).limit(MIX_WINDOW);
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
      return (data ?? []).map((p) => summarizePost(p as never));
    },
    async getPost(id) {
      const { data } = await admin.from("posts").select("*, targets:post_targets(platform,caption,scheduled_at)").eq("id", id).maybeSingle();
      return data ? summarizePost(data as never) : null;
    },
    async createPost(input) {
      const { data, error } = await admin
        .from("posts")
        .insert({
          brand_id: input.brand_id, title: input.title, link_url: input.link_url, media: input.media as Json, category_id: input.category_id,
          source: input.source, recycled_from: input.recycled_from ?? null, status: "pending_approval", created_by: input.created_by ?? null,
        })
        .select("id").single();
      if (error || !data) fail(error);
      const { error: tErr } = await admin.from("post_targets").insert(input.targets.map((t) => ({ post_id: data.id, platform: t.platform, caption: t.caption, scheduled_at: t.scheduled_at })));
      if (tErr) fail(tErr);
      return { post_id: data.id };
    },
    async createArticle(input) {
      const { created_by, ...rest } = input;
      const { data, error } = await admin
        .from("articles")
        .insert({ ...rest, featured_media: rest.featured_media as Json, categories: rest.categories as Json, tags: rest.tags as Json, status: "draft", created_by: created_by ?? null })
        .select("id").single();
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
  };
}
```

- [ ] **Step 3: Fake store for tests**

```ts
// src/lib/ai/fake-store.ts
// In-memory Store used by tool, brief, runner and MCP tests. Not shipped to the browser.
import { vi } from "vitest";
import type { Store, StoreJob, PostSummary, ArticleFull, StoreMedia } from "./store";
import type { CategoryLike } from "./content-mix";

export const BRAND = { id: "b1", slug: "acme", name: "Acme", timezone: "America/Los_Angeles", website_url: "https://acme.com", seo_suffix: "| Acme" };

export function fakeStore(over: Partial<Store> & { jobs?: StoreJob[]; posts?: PostSummary[]; articles?: ArticleFull[]; media?: StoreMedia[]; categories?: CategoryLike[] } = {}): Store & { jobs: StoreJob[]; created: { posts: unknown[]; articles: unknown[] } } {
  const jobs = over.jobs ?? [];
  const posts = over.posts ?? [];
  const articles = over.articles ?? [];
  const media = over.media ?? [];
  const categories = over.categories ?? [];
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
    createPost: vi.fn(async (input) => { created.posts.push(input); return { post_id: "11111111-1111-4111-8111-111111111111" }; }),
    createArticle: vi.fn(async (input) => { created.articles.push(input); return { article_id: "22222222-2222-4222-8222-222222222222" }; }),
    updateArticle: vi.fn(async () => {}),
    listJobs: vi.fn(async (o) => jobs.filter((j) => (!o.status || j.status === o.status) && (!o.runner || j.runner === o.runner) && (!o.brandId || j.brand_id === o.brandId))),
    getJob: vi.fn(async (id) => jobs.find((j) => j.id === id) ?? null),
    transitionJob: vi.fn(async (id, from, patch) => {
      const j = jobs.find((x) => x.id === id);
      if (!j || !from.includes(j.status)) return null;
      Object.assign(j, patch);
      return j;
    }),
    updateJob: vi.fn(async (id, patch) => { const j = jobs.find((x) => x.id === id); if (j) Object.assign(j, patch); }),
    getSetting: vi.fn(async () => null),
  };
  return Object.assign(base, over, { jobs, created });
}

export function job(over: Partial<StoreJob> = {}): StoreJob {
  return {
    id: "33333333-3333-4333-8333-333333333333", brand_id: BRAND.id, type: "caption", status: "queued", runner: "in_app",
    input: { post_id: "44444444-4444-4444-8444-444444444444" }, result: null, error: null, post_id: null, article_id: null, claimed_by: null,
    claimed_at: null, started_at: null, finished_at: null, attempts: 0, model: null, input_tokens: null, output_tokens: null, created_by: null,
    created_at: "2026-09-13T00:00:00Z", updated_at: "2026-09-13T00:00:00Z", ...over,
  };
}
```

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/lib/ai && npm run typecheck`
Expected: pass.

```bash
git add src/lib/ai/store.ts src/lib/ai/store.test.ts src/lib/ai/fake-store.ts
git commit -m "feat(ai): Store interface over Supabase + WP media search"
```

---

### Task 4: Tool layer — lookup tools and registry

**Files:**
- Create: `src/lib/ai/tools/types.ts`
- Create: `src/lib/ai/tools/lookup.ts`, `src/lib/ai/tools/lookup.test.ts`
- Create: `src/lib/ai/tools/registry.ts` (extended in Task 5)

**Interfaces:**
- Produces:

```ts
export type ToolActor = { kind: "in_app" | "mcp"; userId?: string; clientName?: string };
export type ToolCtx = { store: Store; actor: ToolActor };
export type Tool<I = unknown> = { name: string; description: string; input: z.ZodObject<z.ZodRawShape>; run(ctx: ToolCtx, input: I): Promise<unknown> };
export class ToolError extends Error {}   // message is returned to the model / MCP client as an error result
export function defineTool<S extends z.ZodObject<z.ZodRawShape>>(t: { name; description; input: S; run(ctx, input: z.infer<S>) }): Tool<z.infer<S>>;
export async function requireBrand(ctx: ToolCtx, slug: string): Promise<StoreBrand>;  // ToolError "Unknown brand slug"
```

Lookup tools: `list_brands`, `get_brand_guidelines`, `get_content_mix`, `list_media_assets`, `search_wp_media`, `list_articles`, `get_article`, `list_posts`.

- [ ] **Step 1: Failing tests**

```ts
// src/lib/ai/tools/lookup.test.ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/ai/tools`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement types + lookup tools + registry**

```ts
// src/lib/ai/tools/types.ts
import { z } from "zod";
import type { Store, StoreBrand } from "../store";

export type ToolActor = { kind: "in_app" | "mcp"; userId?: string; clientName?: string };
export type ToolCtx = { store: Store; actor: ToolActor };
export type Tool<I = unknown> = { name: string; description: string; input: z.ZodObject<z.ZodRawShape>; run(ctx: ToolCtx, input: I): Promise<unknown> };

/** Errors the model/MCP client should see and can act on. Anything else is a bug and propagates. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function defineTool<S extends z.ZodObject<z.ZodRawShape>>(t: { name: string; description: string; input: S; run(ctx: ToolCtx, input: z.infer<S>): Promise<unknown> }): Tool<z.infer<S>> {
  return t;
}

export async function requireBrand(ctx: ToolCtx, slug: string): Promise<StoreBrand> {
  const b = await ctx.store.getBrandBySlug(slug);
  if (!b) throw new ToolError(`Unknown brand slug "${slug}". Call list_brands for valid slugs.`);
  return b;
}
```

```ts
// src/lib/ai/tools/lookup.ts
import { z } from "zod";
import { defineTool, requireBrand, ToolError } from "./types";
import { computeContentMix } from "../content-mix";
import { GUIDELINE_KINDS } from "@/lib/guidelines/kinds";

const brand = z.string().describe("Brand slug, e.g. 'acme'. Use list_brands to discover slugs.");
const KINDS = GUIDELINE_KINDS.map((k) => k.kind) as [string, ...string[]];

export const listBrands = defineTool({
  name: "list_brands",
  description: "List active brands with slug, name, timezone, website, SEO suffix and which connections are live (wordpress/meta/pinterest/semrush).",
  input: z.object({}),
  run: (ctx) => ctx.store.listBrands(),
});

export const getBrandGuidelines = defineTool({
  name: "get_brand_guidelines",
  description: "Fetch a brand's writing rules. ALWAYS call this before writing anything. For captions read social_style + social_post_spec; for articles read blog_style + blog_post_spec. Omit kind to get every document.",
  input: z.object({ brand, kind: z.enum(KINDS).optional() }),
  run: async (ctx, { brand: slug, kind }) => {
    const b = await requireBrand(ctx, slug);
    const docs = await ctx.store.getGuidelines(b.id);
    return kind ? { [kind]: docs[kind as keyof typeof docs] } : docs;
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
  input: z.object({ brand, status: z.array(z.enum(["draft", "pending_approval", "approved", "publishing", "published", "failed", "archived"])).optional(), limit: z.number().int().min(1).max(50).default(20) }),
  run: async (ctx, { brand: slug, status, limit }) => ctx.store.listPosts((await requireBrand(ctx, slug)).id, status, limit),
});

export const LOOKUP_TOOLS = [listBrands, getBrandGuidelines, getContentMix, listMediaAssets, searchWpMedia, listArticles, getArticle, listPosts];
```

```ts
// src/lib/ai/tools/registry.ts
import type { Tool } from "./types";
import { LOOKUP_TOOLS } from "./lookup";

export const allTools: Tool[] = [...LOOKUP_TOOLS];
/** Tools the in-app agent gets (the runner owns the job, so queue tools are excluded). Extended in Task 5. */
export const agentTools: Tool[] = [...LOOKUP_TOOLS];
export function findTool(name: string): Tool | undefined {
  return allTools.find((t) => t.name === name);
}
```

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/lib/ai && npm run typecheck && npm run lint`
Expected: pass.

```bash
git add src/lib/ai/tools
git commit -m "feat(ai): tool types, lookup tools, registry"
```

---

### Task 5: Write tools, queue tools, brief builder

**Files:**
- Create: `src/lib/ai/tools/write.ts`, `src/lib/ai/tools/write.test.ts`
- Create: `src/lib/ai/tools/queue.ts`, `src/lib/ai/tools/queue.test.ts`
- Create: `src/lib/ai/brief.ts`, `src/lib/ai/brief.test.ts`
- Modify: `src/lib/ai/tools/registry.ts`

**Interfaces:**
- Produces tools `create_post`, `submit_captions`, `create_article`, `update_article`, `list_jobs`, `claim_job`, `complete_job`; `buildBrief(store, job): Promise<Brief>`; registry `allTools` (all 15) and `agentTools` (all minus the three queue tools).
- `Brief` shape:

```ts
export type Brief = {
  job: { id: string; type: JobType; input: unknown };
  brand: StoreBrand;
  guidelines: Record<GuidelineKind, string>;
  content_mix: ContentMix;
  post?: PostSummary;                 // caption, rewrite
  article?: ArticleFull;              // promo
  media?: StoreMedia[];               // article
  existing_articles?: ArticleSummary[]; // article
  recent_captions?: { platform: string; caption: string }[]; // caption, rewrite, promo (last 5 approved/published)
  instructions: string;               // type-specific, from prompts (Task 7 fills; here a constant per type)
};
```

- [ ] **Step 1: Failing tests for write tools**

```ts
// src/lib/ai/tools/write.test.ts
import { describe, it, expect } from "vitest";
import { fakeStore, BRAND, job } from "@/lib/ai/fake-store";
import { createPost, submitCaptions, createArticle } from "@/lib/ai/tools/write";

const ctx = (store = fakeStore()) => ({ store, actor: { kind: "in_app" as const } });
const good = { facebook: "We're on site and it's looking great 🔥", instagram: "We're on site and it's looking great 🔥" };

describe("create_post", () => {
  it("creates a pending_approval post with targets and category", async () => {
    const store = fakeStore({ categories: [{ id: "c1", name: "Tips", slug: "tips", target_share: 1, description: null, sort_order: 0 }] });
    const out = await createPost.run(ctx(store), { brand: "acme", title: "T", targets: [{ platform: "facebook", caption: good.facebook }], category_slug: "tips" });
    expect(out).toEqual({ post_id: "11111111-1111-4111-8111-111111111111" });
    expect(store.createPost).toHaveBeenCalledWith(expect.objectContaining({ brand_id: BRAND.id, category_id: "c1", source: "ai", targets: [{ platform: "facebook", caption: good.facebook, scheduled_at: null }] }));
  });
  it("rejects captions that break hard rules and creates nothing", async () => {
    const store = fakeStore();
    await expect(createPost.run(ctx(store), { brand: "acme", title: "T", targets: [{ platform: "facebook", caption: "Actually — fine" }] })).rejects.toThrow(/em dash/);
    expect(store.createPost).not.toHaveBeenCalled();
  });
  it("rejects an unknown category slug", async () => {
    await expect(createPost.run(ctx(), { brand: "acme", title: "T", targets: [{ platform: "facebook", caption: good.facebook }], category_slug: "nope" })).rejects.toThrow(/category/i);
  });
});

describe("submit_captions", () => {
  it("writes the result onto a running job", async () => {
    const store = fakeStore({ jobs: [job({ status: "running" })] });
    await submitCaptions.run(ctx(store), { job_id: store.jobs[0].id, captions: good, category_slug: undefined });
    expect(store.jobs[0].result).toEqual({ captions: good });
  });
  it("validates captions", async () => {
    const store = fakeStore({ jobs: [job({ status: "running" })] });
    await expect(submitCaptions.run(ctx(store), { job_id: store.jobs[0].id, captions: { ...good, instagram: "it's actually" } })).rejects.toThrow(/actually/);
  });
});

describe("create_article", () => {
  const base = { brand: "acme", title: "Deck Staining Guide", slug: "deck-staining-guide", content_html: "<h2>Why</h2><p>Because.</p>", featured_media_url: "https://cdn/x.jpg", featured_alt: "A deck", decision: "new" as const };
  it("creates a draft and returns warnings for SEO fields", async () => {
    const store = fakeStore();
    const out = (await createArticle.run(ctx(store), { ...base, seo_title: "Deck Staining", meta_description: "short" })) as { article_id: string; warnings: string[] };
    expect(out.article_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(out.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/suffix/), expect.stringMatching(/120/)]));
    expect(store.createArticle).toHaveBeenCalledWith(expect.objectContaining({ brand_id: BRAND.id, source: "ai", featured_media: { url: "https://cdn/x.jpg", alt: "A deck" } }));
  });
  it("rejects data: image URLs", async () => {
    await expect(createArticle.run(ctx(), { ...base, content_html: '<img src="data:image/png;base64,AAA">' })).rejects.toThrow(/data:/);
  });
});
```

- [ ] **Step 2: Implement write tools**

```ts
// src/lib/ai/tools/write.ts
import { z } from "zod";
import { defineTool, requireBrand, ToolError } from "./types";
import { validateCaption } from "../captions";
import { captionsSchema } from "../schemas";
import { finalSeoTitle, metaDescriptionWarning } from "@/lib/articles/push";
import type { MediaItem } from "@/lib/database.types";

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

async function resolveCategory(ctx: Parameters<typeof createPost.run>[0], brandId: string, slug?: string): Promise<string | null> {
  if (!slug) return null;
  const cats = await ctx.store.listCategories(brandId);
  const c = cats.find((x) => x.slug === slug);
  if (!c) throw new ToolError(`Unknown category slug "${slug}". Valid: ${cats.map((x) => x.slug).join(", ") || "(none)"}`);
  return c.id;
}

export const createPost = defineTool({
  name: "create_post",
  description: "Create a social post. Lands as pending_approval; a human approves it before anything publishes. Captions must follow the brand's hard rules (no em/en dashes, never 'actually', contractions, platform length) or the call is rejected with the violations.",
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
    await ctx.store.updateJob(job_id, { result });
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

function articleWarnings(i: { seo_title?: string; title: string; meta_description?: string }, suffix: string | null): string[] {
  const out: string[] = [];
  const final = finalSeoTitle(i.seo_title ?? null, i.title, suffix);
  if (suffix && i.seo_title && !i.seo_title.trim().endsWith(suffix.trim())) out.push(`seo_title should end with the brand suffix "${suffix}" (will render as "${final}")`);
  const md = metaDescriptionWarning(i.meta_description ?? null);
  if (md) out.push(md);
  return out;
}

export const createArticle = defineTool({
  name: "create_article",
  description: "Create a blog article draft. ALWAYS read blog_style + blog_post_spec first. Returns { article_id, warnings } — warnings are advisory (SEO title suffix, meta length). Body <img> tags must use hosted URLs; every image is re-hosted into WordPress on push.",
  input: z.object({ brand, ...articleFields }),
  run: async (ctx, i) => {
    const b = await requireBrand(ctx, i.brand);
    if (/src=["']data:/i.test(i.content_html)) throw new ToolError("content_html contains a data: image URL. Use hosted image URLs from list_media_assets or search_wp_media.");
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
  input: z.object({ id: z.string().uuid(), ...Object.fromEntries(Object.entries(articleFields).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof articleFields]: z.ZodOptional<(typeof articleFields)[K]> } }),
  run: async (ctx, { id, featured_media_url, featured_alt, ...rest }) => {
    const a = await ctx.store.getArticle(id);
    if (!a) throw new ToolError(`Article ${id} not found`);
    if (rest.content_html && /src=["']data:/i.test(rest.content_html)) throw new ToolError("content_html contains a data: image URL");
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    if (featured_media_url) patch.featured_media = { url: featured_media_url, alt: featured_alt ?? a.featured_media?.alt ?? null };
    await ctx.store.updateArticle(id, patch);
    return { ok: true };
  },
});

export const WRITE_TOOLS = [createPost, submitCaptions, createArticle, updateArticle];
```

- [ ] **Step 3: Queue tools tests + implementation**

```ts
// src/lib/ai/tools/queue.test.ts
import { describe, it, expect } from "vitest";
import { fakeStore, job } from "@/lib/ai/fake-store";
import { listJobs, claimJob, completeJob } from "@/lib/ai/tools/queue";

const ctx = (store = fakeStore()) => ({ store, actor: { kind: "mcp" as const, clientName: "claude-code" } });

describe("queue tools", () => {
  it("list_jobs only shows mcp-runner jobs, default queued", async () => {
    const store = fakeStore({ jobs: [job({ id: "a", runner: "mcp" }), job({ id: "b", runner: "in_app" }), job({ id: "c", runner: "mcp", status: "completed" })] });
    const out = (await listJobs.run(ctx(store), {})) as { id: string }[];
    expect(out.map((j) => j.id)).toEqual(["a"]);
  });
  it("claim_job is atomic and returns the brief", async () => {
    const store = fakeStore({ jobs: [job({ runner: "mcp", type: "article", input: { topic: "Deck staining", decision: "new", secondary_keywords: [] } })] });
    const out = (await claimJob.run(ctx(store), { job_id: store.jobs[0].id })) as { job: { status: string }; brief: { brand: { slug: string } } };
    expect(out.job.status).toBe("claimed");
    expect(store.jobs[0]).toMatchObject({ status: "claimed", claimed_by: "claude-code" });
    expect(out.brief.brand.slug).toBe("acme");
    await expect(claimJob.run(ctx(store), { job_id: store.jobs[0].id })).rejects.toThrow(/already claimed/);
  });
  it("complete_job validates the result shape and marks failed on error", async () => {
    const store = fakeStore({ jobs: [job({ runner: "mcp", status: "claimed" })] });
    await expect(completeJob.run(ctx(store), { job_id: store.jobs[0].id, result: { nope: 1 } })).rejects.toThrow(/result/i);
    await completeJob.run(ctx(store), { job_id: store.jobs[0].id, error: "gave up" });
    expect(store.jobs[0]).toMatchObject({ status: "failed", error: "gave up" });
  });
});
```

```ts
// src/lib/ai/tools/queue.ts
import { z } from "zod";
import { defineTool, ToolError } from "./types";
import { parseJobResult, JOB_TYPES } from "../schemas";
import { buildBrief } from "../brief";

export const listJobs = defineTool({
  name: "list_jobs",
  description: "Generation jobs queued for an external agent (runner=mcp). Poll this to find work (default status 'queued'), then claim_job.",
  input: z.object({ brand: z.string().optional(), status: z.enum(["queued", "claimed", "running", "completed", "failed"]).default("queued") }),
  run: async (ctx, { brand, status }) => {
    const b = brand ? await ctx.store.getBrandBySlug(brand) : null;
    if (brand && !b) throw new ToolError(`Unknown brand slug "${brand}"`);
    return ctx.store.listJobs({ brandId: b?.id, status, runner: "mcp" });
  },
});

export const claimJob = defineTool({
  name: "claim_job",
  description: "Atomically claim a queued job so no other agent takes it. Returns { job, brief } where brief has the brand, guidelines, content mix, the source post/article, media and type-specific instructions. Follow brief.instructions exactly and finish with complete_job.",
  input: z.object({ job_id: z.string().uuid() }),
  run: async (ctx, { job_id }) => {
    const j = await ctx.store.transitionJob(job_id, ["queued"], { status: "claimed", claimed_by: ctx.actor.clientName ?? "mcp", claimed_at: new Date().toISOString() });
    if (!j) {
      const cur = await ctx.store.getJob(job_id);
      throw new ToolError(cur ? `Job ${job_id} already claimed (status ${cur.status})` : `Job ${job_id} not found`);
    }
    return { job: j, brief: await buildBrief(ctx.store, j) };
  },
});

export const completeJob = defineTool({
  name: "complete_job",
  description: "Finish a job you claimed. Pass result in the job type's shape — caption: {captions:{facebook,instagram}, category_slug?}; article: {article_id}; promo/rewrite: {post_id} — or error to mark it failed.",
  input: z.object({ job_id: z.string().uuid(), result: z.record(z.string(), z.unknown()).optional(), error: z.string().optional() }),
  run: async (ctx, { job_id, result, error }) => {
    const j = await ctx.store.getJob(job_id);
    if (!j) throw new ToolError(`Job ${job_id} not found`);
    if (!JOB_TYPES.includes(j.type)) throw new ToolError(`Unknown job type ${j.type}`);
    const now = new Date().toISOString();
    if (error) {
      await ctx.store.transitionJob(job_id, ["claimed", "running"], { status: "failed", error, finished_at: now });
      return { ok: true, status: "failed" };
    }
    const parsed = parseJobResult(j.type, result);
    if (!parsed.success) throw new ToolError(`result does not match the ${j.type} result shape: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    const r = parsed.data as Record<string, unknown>;
    const done = await ctx.store.transitionJob(job_id, ["claimed", "running"], {
      status: "completed", result: r, finished_at: now, error: null,
      post_id: (r.post_id as string | undefined) ?? j.post_id, article_id: (r.article_id as string | undefined) ?? j.article_id,
    });
    if (!done) throw new ToolError(`Job ${job_id} is ${j.status}; only claimed/running jobs can be completed`);
    return { ok: true, status: "completed" };
  },
});

export const QUEUE_TOOLS = [listJobs, claimJob, completeJob];
```

- [ ] **Step 4: Brief builder test + implementation**

```ts
// src/lib/ai/brief.test.ts
import { describe, it, expect } from "vitest";
import { fakeStore, job, BRAND } from "@/lib/ai/fake-store";
import { buildBrief } from "@/lib/ai/brief";

const post = { id: "44444444-4444-4444-8444-444444444444", brand_id: BRAND.id, title: "New deck", link_url: null, media: [{ url: "https://cdn/a.jpg", alt: "deck" }], status: "draft" as const, category_id: null, targets: [] };

describe("buildBrief", () => {
  it("caption brief carries the post, guidelines, mix and recent captions", async () => {
    const store = fakeStore({ posts: [post, { ...post, id: "55555555-5555-4555-8555-555555555555", status: "published", targets: [{ platform: "facebook", caption: "Old one", scheduled_at: null }] }] });
    const b = await buildBrief(store, job());
    expect(b.post?.id).toBe(post.id);
    expect(b.guidelines.social_style).toBe("Be upbeat.");
    expect(b.recent_captions).toEqual([{ platform: "facebook", caption: "Old one" }]);
    expect(b.instructions).toMatch(/submit_captions/);
  });
  it("article brief includes media and existing articles", async () => {
    const store = fakeStore({ media: [{ id: "m", url: "https://cdn/a.jpg", alt: "a", tags: [], used_as_featured: false }] });
    const b = await buildBrief(store, job({ type: "article", input: { topic: "Deck staining", decision: "new", secondary_keywords: [] } }));
    expect(b.media).toHaveLength(1);
    expect(b.existing_articles).toEqual([]);
  });
  it("fails clearly when the source record is missing", async () => {
    await expect(buildBrief(fakeStore(), job({ type: "promo", input: { article_id: "66666666-6666-4666-8666-666666666666" } }))).rejects.toThrow(/Article .* not found/);
  });
});
```

```ts
// src/lib/ai/brief.ts
import type { Store, StoreJob, StoreBrand, PostSummary, ArticleFull, ArticleSummary, StoreMedia } from "./store";
import { computeContentMix, type ContentMix } from "./content-mix";
import { parseJobInput, type JobType } from "./schemas";
import { INSTRUCTIONS } from "./prompts/instructions";
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
  instructions: string;
};

export async function buildBrief(store: Store, j: StoreJob): Promise<Brief> {
  const parsed = parseJobInput(j.type, j.input);
  if (!parsed.success) throw new Error(`Job ${j.id} has invalid input: ${parsed.error.issues[0]?.message}`);
  const input = parsed.data as Record<string, string>;
  const brand = await store.getBrandById(j.brand_id);
  if (!brand) throw new Error(`Brand ${j.brand_id} not found`);
  const [guidelines, cats, recentPosts] = await Promise.all([store.getGuidelines(brand.id), store.listCategories(brand.id), store.listRecentCategorizedPosts(brand.id)]);
  const brief: Brief = { job: { id: j.id, type: j.type, input: parsed.data }, brand, guidelines, content_mix: computeContentMix(cats, recentPosts), instructions: INSTRUCTIONS[j.type] };

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
```

```ts
// src/lib/ai/prompts/instructions.ts
import type { JobType } from "../schemas";

/** Type-specific marching orders. Shared by the in-app runner (system prompt) and claim_job (brief.instructions). */
export const INSTRUCTIONS: Record<JobType, string> = {
  caption: [
    "Write a Facebook caption and an Instagram caption for the post in `post` (title, link, images with alt text).",
    "Follow social_style and social_post_spec exactly. Match the tone of `recent_captions`.",
    "Pick the category from `content_mix.favour_next` unless the post clearly belongs elsewhere; pass it as category_slug.",
    "Finish by calling submit_captions exactly once with both captions. Do not call create_post.",
  ].join("\n"),
  article: [
    "Write a complete SEO blog article for the brief in `job.input` (topic, keywords, decision, notes).",
    "Follow blog_style and blog_post_spec exactly. H1 = title with the primary keyword near the front; use <h2>/<h3> sections; 900–1500 words unless the spec says otherwise.",
    "Choose a featured image from `media` with used_as_featured=false, and 1–3 body images; if nothing fits, call search_wp_media. Use hosted URLs only.",
    "Link to 1–3 relevant `existing_articles` by url where natural.",
    "seo_title must end with the brand's seo_suffix; meta_description 120–156 chars including the primary keyword; slug contains the primary keyword.",
    "Finish by calling create_article exactly once. If it returns warnings, fix them with update_article.",
  ].join("\n"),
  promo: [
    "Write a short social post promoting `article` (title, excerpt, url, featured_media).",
    "Condense the article into a hook + 1–2 lines of value + CTA like \"Read more here 👉 <url>\". Use featured_media.url as the image and link_url = article.url.",
    "If job.input.scheduled_after is set, schedule both targets at or after it (ISO with the brand timezone offset).",
    "Finish by calling create_post exactly once with article_id = job.input.article_id.",
  ].join("\n"),
  rewrite: [
    "Write a fresh variant of the captions on `post`: same facts, same media and link, new angle and opening. Do not reuse the first sentence.",
    "Follow social_style and social_post_spec. Keep the same category if the post has one.",
    "Finish by calling create_post exactly once with recycled_from = post.id, media_urls = post.media urls, link_url = post.link_url.",
  ].join("\n"),
};
```

- [ ] **Step 5: Extend the registry**

```ts
// src/lib/ai/tools/registry.ts
import type { Tool } from "./types";
import { LOOKUP_TOOLS } from "./lookup";
import { WRITE_TOOLS } from "./write";
import { QUEUE_TOOLS } from "./queue";

export const allTools: Tool[] = [...LOOKUP_TOOLS, ...WRITE_TOOLS, ...QUEUE_TOOLS];
/** The in-app agent owns its job, so it never sees the queue tools. */
export const agentTools: Tool[] = [...LOOKUP_TOOLS, ...WRITE_TOOLS];
export function findTool(name: string): Tool | undefined {
  return allTools.find((t) => t.name === name);
}
```

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run src/lib/ai && npm run typecheck && npm run lint`
Expected: pass.

```bash
git add src/lib/ai
git commit -m "feat(ai): write tools, queue tools, brief builder, instructions"
```

---

### Task 6: MCP route

**Files:**
- Create: `src/lib/ai/mcp-server.ts`, `src/lib/ai/mcp-server.test.ts`
- Create: `src/app/api/mcp/route.ts`

**Interfaces:**
- Produces `createMcpServer(ctx: ToolCtx): McpServer`, `handleMcpRequest(req: Request, deps: { store: Store; token: string }): Promise<Response>`.

- [ ] **Step 1: Failing in-process test (MCP client over the handler)**

```ts
// src/lib/ai/mcp-server.test.ts
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleMcpRequest } from "@/lib/ai/mcp-server";
import { fakeStore } from "@/lib/ai/fake-store";

const TOKEN = "test-mcp-token-0000000000000000000000";
function fetchVia(store = fakeStore()): typeof fetch {
  return (input, init) => handleMcpRequest(new Request(input, init), { store, token: TOKEN });
}
async function connect(headers: Record<string, string>) {
  const client = new Client({ name: "test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://app.test/api/mcp"), { fetch: fetchVia(), requestInit: { headers } });
  await client.connect(transport);
  return client;
}

describe("MCP server", () => {
  it("rejects a missing or wrong token with 401", async () => {
    const res = await handleMcpRequest(new Request("http://app.test/api/mcp", { method: "POST", body: "{}" }), { store: fakeStore(), token: TOKEN });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
    await expect(connect({ Authorization: "Bearer nope" })).rejects.toThrow();
  });
  it("lists every registry tool and calls list_brands", async () => {
    const client = await connect({ Authorization: `Bearer ${TOKEN}` });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["claim_job", "complete_job", "create_article", "create_post", "get_article", "get_brand_guidelines", "get_content_mix", "list_articles", "list_brands", "list_jobs", "list_media_assets", "list_posts", "search_wp_media", "submit_captions", "update_article"],
    );
    const r = await client.callTool({ name: "list_brands", arguments: {} });
    expect(JSON.parse((r.content as { text: string }[])[0].text)[0].slug).toBe("acme");
  });
  it("returns tool errors as isError results, not protocol errors", async () => {
    const client = await connect({ Authorization: `Bearer ${TOKEN}` });
    const r = await client.callTool({ name: "get_brand_guidelines", arguments: { brand: "nope" } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toMatch(/Unknown brand/);
  });
  it("GET is 405", async () => {
    const res = await handleMcpRequest(new Request("http://app.test/api/mcp", { method: "GET", headers: { Authorization: `Bearer ${TOKEN}` } }), { store: fakeStore(), token: TOKEN });
    expect(res.status).toBe(405);
  });
});
```

- [ ] **Step 2: Implement the server + handler**

```ts
// src/lib/ai/mcp-server.ts
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { allTools } from "./tools/registry";
import { ToolError, type ToolCtx } from "./tools/types";
import type { Store } from "./store";

function tokenOk(req: Request, want: string): boolean {
  const h = req.headers.get("authorization") ?? "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : "";
  return given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export function createMcpServer(ctx: ToolCtx): McpServer {
  const server = new McpServer({ name: "jamsam-social", version: "1.0.0" });
  for (const tool of allTools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input.shape }, async (args) => {
      try {
        const clientName = server.server.getClientVersion()?.name;
        const out = await tool.run({ ...ctx, actor: { ...ctx.actor, clientName: clientName ?? ctx.actor.clientName } }, args);
        return { content: [{ type: "text", text: JSON.stringify(out ?? null) }] };
      } catch (e) {
        if (e instanceof ToolError) return { isError: true, content: [{ type: "text", text: e.message }] };
        throw e;
      }
    });
  }
  return server;
}

/** Stateless: a fresh server + transport per request, no session ids. POST only. */
export async function handleMcpRequest(req: Request, deps: { store: Store; token: string }): Promise<Response> {
  if (!tokenOk(req, deps.token)) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="jamsam-social"', "Content-Type": "application/json" } });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  const server = createMcpServer({ store: deps.store, actor: { kind: "mcp" } });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Close after the response is produced so the next request starts clean.
    void transport.close().catch(() => {});
  }
}
```

```ts
// src/app/api/mcp/route.ts
import { env } from "@/lib/env";
import { createSupabaseStore } from "@/lib/ai/store";
import { handleMcpRequest } from "@/lib/ai/mcp-server";

export const maxDuration = 60;

const handler = (req: Request) => handleMcpRequest(req, { store: createSupabaseStore(), token: env.MCP_TOKEN });
export const POST = handler;
export const GET = handler;
export const DELETE = handler;
```

If `registerTool` rejects `tool.input.shape` typing, pass `tool.input` (the SDK accepts a zod object schema as well as a raw shape in 1.30); keep whichever typechecks. If the client test cannot connect because the SDK client sends an `Accept: application/json, text/event-stream` header the JSON-response mode rejects, drop `enableJsonResponse` (SSE responses also work through `fetch`).

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run src/lib/ai/mcp-server.test.ts && npm run typecheck && npm run lint`
Expected: pass. Then a live smoke against the dev server:

```bash
curl -s -X POST http://localhost:3000/api/mcp -H "Authorization: Bearer $(grep ^MCP_TOKEN .env.local | cut -d= -f2)" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```
Expected: a JSON-RPC result with `serverInfo.name = "jamsam-social"`.

```bash
git add src/lib/ai/mcp-server.ts src/lib/ai/mcp-server.test.ts src/app/api/mcp/route.ts
git commit -m "feat(ai): MCP server route (stateless streamable HTTP, bearer token)"
```

---

### Task 7: In-app runner, prompts, enqueue/retry/cancel actions, cron backstop, job status API

**Files:**
- Create: `src/lib/ai/prompts/system.ts`
- Create: `src/lib/ai/runner.ts`, `src/lib/ai/runner.test.ts`
- Create: `src/lib/jobs/actions.ts`, `src/lib/jobs/queries.ts`
- Create: `src/lib/jobs/backstop.ts`, `src/lib/jobs/backstop.test.ts`
- Create: `src/app/api/cron/jobs/route.ts`
- Create: `src/app/api/jobs/[id]/route.ts`

**Interfaces:**
- Produces:
  - `buildSystemPrompt(brief: Brief): string`
  - `runJobWith(jobId, deps: RunnerDeps): Promise<"completed" | "failed" | "skipped">` where `RunnerDeps = { store: Store; client: Pick<Anthropic, "messages">; model: string; maxTurns?: number; maxInputTokens?: number; sleep?: (ms) => Promise<void> }`
  - `runJob(jobId): Promise<void>` (real deps, swallows/records errors)
  - `enqueueJob(input: { brandId; type; input; runner }): Promise<ActionResult & { id?: string }>`, `retryJob(id)`, `cancelJob(id)`
  - `listJobsForBrand(brandId)`, `getJobPublic(id)` (server supabase)
  - `selectStaleJobs(jobs, now): { run: StoreJob[]; giveUp: StoreJob[] }` (pure) and `runBackstop(store, run)`.
- Consumes: Task 5 `agentTools`, `TERMINAL_TOOL`, `buildBrief`.

- [ ] **Step 1: System prompt**

```ts
// src/lib/ai/prompts/system.ts
import type { Brief } from "../brief";

export function buildSystemPrompt(b: Brief): string {
  const g = b.guidelines;
  const docs = b.job.type === "article" ? [["blog_style", g.blog_style], ["blog_post_spec", g.blog_post_spec]] : [["social_style", g.social_style], ["social_post_spec", g.social_post_spec]];
  return [
    `You are the content writer for the brand "${b.brand.name}" (slug ${b.brand.slug}, timezone ${b.brand.timezone}${b.brand.website_url ? `, website ${b.brand.website_url}` : ""}${b.brand.seo_suffix ? `, SEO suffix "${b.brand.seo_suffix}"` : ""}).`,
    "Follow the guideline documents below verbatim. Where they conflict on mechanics, the *_spec document wins.",
    "Hard rules enforced in code: no em or en dashes, never the word \"actually\", use contractions, respect platform caption limits. A tool call that breaks them is rejected with the violations — fix and call again.",
    "Use tools to look things up instead of guessing. Do not invent specs, prices or facts. Finish by calling the terminal tool exactly once, then stop.",
    "",
    "## Task",
    b.instructions,
    "",
    ...docs.flatMap(([name, body]) => [`## ${name}`, body || "(no document yet — use sensible defaults)", ""]),
  ].join("\n");
}
```

- [ ] **Step 2: Failing runner tests with a scripted fake Anthropic client**

```ts
// src/lib/ai/runner.test.ts
import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runJobWith } from "@/lib/ai/runner";
import { fakeStore, job, BRAND } from "@/lib/ai/fake-store";

const post = { id: "44444444-4444-4444-8444-444444444444", brand_id: BRAND.id, title: "New deck", link_url: null, media: [], status: "draft" as const, category_id: null, targets: [] };
const good = "We're on site and it's looking great 🔥";

type Turn = { tool?: { name: string; input: unknown }; text?: string };
/** Each call to messages.stream() consumes the next scripted turn. */
function fakeClient(turns: Turn[]) {
  let n = 0;
  const calls: unknown[] = [];
  const stream = vi.fn((params: unknown) => {
    calls.push(params);
    const t = turns[n++] ?? { text: "done" };
    const content = t.tool ? [{ type: "tool_use", id: `tu${n}`, name: t.tool.name, input: t.tool.input }] : [{ type: "text", text: t.text }];
    const message = { content, stop_reason: t.tool ? "tool_use" : "end_turn", usage: { input_tokens: 100, output_tokens: 50 } };
    return { finalMessage: async () => message };
  });
  return { client: { messages: { stream } } as unknown as Pick<Anthropic, "messages">, calls };
}

describe("runJobWith", () => {
  it("runs lookups, retries after a validation error, completes on the terminal tool", async () => {
    const store = fakeStore({ jobs: [job()], posts: [post] });
    const { client, calls } = fakeClient([
      { tool: { name: "get_content_mix", input: { brand: "acme" } } },
      { tool: { name: "submit_captions", input: { job_id: store.jobs[0].id, captions: { facebook: "Actually — no", instagram: good } } } },
      { tool: { name: "submit_captions", input: { job_id: store.jobs[0].id, captions: { facebook: good, instagram: good } } } },
    ]);
    expect(await runJobWith(store.jobs[0].id, { store, client, model: "claude-opus-5" })).toBe("completed");
    expect(store.jobs[0]).toMatchObject({ status: "completed", attempts: 1, model: "claude-opus-5", input_tokens: 300, output_tokens: 150, result: { captions: { facebook: good, instagram: good } } });
    // The rejected call was fed back as an error tool_result
    const third = calls[2] as { messages: { content: { type: string; is_error?: boolean; content?: string }[] }[] };
    const lastUser = third.messages[third.messages.length - 1].content[0];
    expect(lastUser).toMatchObject({ type: "tool_result", is_error: true });
    expect(lastUser.content).toMatch(/em dash/);
    expect((calls[0] as { system: string }).system).toMatch(/Be upbeat\./);
  });
  it("skips a job that is not queued", async () => {
    const store = fakeStore({ jobs: [job({ status: "completed" })] });
    const { client } = fakeClient([]);
    expect(await runJobWith(store.jobs[0].id, { store, client, model: "m" })).toBe("skipped");
  });
  it("fails after maxTurns without a terminal tool and leaves no partial records", async () => {
    const store = fakeStore({ jobs: [job()], posts: [post] });
    const { client } = fakeClient(Array(5).fill({ tool: { name: "get_content_mix", input: { brand: "acme" } } }));
    expect(await runJobWith(store.jobs[0].id, { store, client, model: "m", maxTurns: 3 })).toBe("failed");
    expect(store.jobs[0].error).toMatch(/3 turns/);
    expect(store.created.posts).toHaveLength(0);
  });
  it("fails when the model ends its turn without calling the terminal tool", async () => {
    const store = fakeStore({ jobs: [job()], posts: [post] });
    const { client } = fakeClient([{ text: "Here are your captions: ..." }]);
    expect(await runJobWith(store.jobs[0].id, { store, client, model: "m" })).toBe("failed");
    expect(store.jobs[0].error).toMatch(/without calling submit_captions/);
  });
  it("retries transient API errors then fails", async () => {
    const store = fakeStore({ jobs: [job()], posts: [post] });
    const stream = vi.fn(() => { throw Object.assign(new Error("overloaded"), { status: 529 }); });
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    expect(await runJobWith(store.jobs[0].id, { store, client, model: "m", sleep: async () => {} })).toBe("failed");
    expect(stream).toHaveBeenCalledTimes(3);
    expect(store.jobs[0].error).toMatch(/overloaded/);
  });
  it("article jobs complete on create_article and record article_id", async () => {
    const store = fakeStore({ jobs: [job({ type: "article", input: { topic: "Deck staining", decision: "new", secondary_keywords: [] } })] });
    const { client } = fakeClient([{ tool: { name: "create_article", input: { brand: "acme", title: "Deck Staining", slug: "deck-staining", content_html: "<p>x</p>", featured_media_url: "https://cdn/x.jpg", featured_alt: "deck", decision: "new" } } }]);
    expect(await runJobWith(store.jobs[0].id, { store, client, model: "m" })).toBe("completed");
    expect(store.jobs[0]).toMatchObject({ status: "completed", article_id: "22222222-2222-4222-8222-222222222222", result: { article_id: "22222222-2222-4222-8222-222222222222" } });
  });
});
```

- [ ] **Step 3: Implement the runner**

```ts
// src/lib/ai/runner.ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/lib/env";
import { createSupabaseStore, type Store } from "./store";
import { agentTools } from "./tools/registry";
import { ToolError } from "./tools/types";
import { buildBrief } from "./brief";
import { buildSystemPrompt } from "./prompts/system";
import { TERMINAL_TOOL, parseJobResult } from "./schemas";

export const DEFAULT_MODEL = "claude-opus-5";
export type RunnerDeps = {
  store: Store;
  client: Pick<Anthropic, "messages">;
  model: string;
  maxTurns?: number;
  maxInputTokens?: number;
  sleep?: (ms: number) => Promise<void>;
};

function toAnthropicTool(t: (typeof agentTools)[number]): Anthropic.Tool {
  const schema = z.toJSONSchema(t.input) as Record<string, unknown>;
  delete schema.$schema;
  return { name: t.name, description: t.description, input_schema: schema as Anthropic.Tool.InputSchema };
}

function isTransient(e: unknown): boolean {
  const s = (e as { status?: number }).status;
  return s === 429 || s === 408 || s === 409 || (typeof s === "number" && s >= 500);
}

async function createWithRetry(deps: RunnerDeps, params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await deps.client.messages.stream(params).finalMessage();
    } catch (e) {
      last = e;
      if (!isTransient(e)) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw last;
}

/** Runs one queued in-app job to completion. Pure over deps so tests can script the model. */
export async function runJobWith(jobId: string, deps: RunnerDeps): Promise<"completed" | "failed" | "skipped"> {
  const { store } = deps;
  const maxTurns = deps.maxTurns ?? 20;
  const maxInput = deps.maxInputTokens ?? 150_000;
  const startedAt = new Date().toISOString();
  const current = await store.getJob(jobId);
  if (!current) return "skipped";
  const running = await store.transitionJob(jobId, ["queued"], { status: "running", started_at: startedAt, attempts: current.attempts + 1, claimed_by: "in_app", claimed_at: startedAt, error: null });
  if (!running) return "skipped";

  const fail = async (error: string) => {
    await store.updateJob(jobId, { status: "failed", error: error.slice(0, 2000), finished_at: new Date().toISOString(), model: deps.model });
    return "failed" as const;
  };

  try {
    const brief = await buildBrief(store, running);
    const terminal = TERMINAL_TOOL[running.type];
    const tools = agentTools.map(toAnthropicTool);
    const ctx = { store, actor: { kind: "in_app" as const, userId: running.created_by ?? undefined } };
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: `Job brief (JSON):\n${JSON.stringify(brief, null, 2)}` }];
    const system = buildSystemPrompt(brief);
    let inputTokens = 0, outputTokens = 0;

    for (let turn = 0; turn < maxTurns; turn++) {
      const res = await createWithRetry(deps, { model: deps.model, max_tokens: 16000, system, tools, messages });
      inputTokens += res.usage.input_tokens; outputTokens += res.usage.output_tokens;
      await store.updateJob(jobId, { input_tokens: inputTokens, output_tokens: outputTokens, model: deps.model });
      if (inputTokens > maxInput) return fail(`Token budget exceeded (${inputTokens} input tokens > ${maxInput})`);
      if (res.stop_reason === "refusal") return fail("Model refused the request");
      messages.push({ role: "assistant", content: res.content });
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (uses.length === 0) return fail(`Model ended its turn without calling ${terminal}`);

      const results: Anthropic.ToolResultBlockParam[] = [];
      let done: unknown = null;
      for (const u of uses) {
        const tool = agentTools.find((t) => t.name === u.name);
        try {
          if (!tool) throw new ToolError(`Unknown tool ${u.name}`);
          const parsed = tool.input.safeParse(u.input);
          if (!parsed.success) throw new ToolError(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
          const out = await tool.run(ctx, parsed.data);
          results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out ?? null) });
          if (u.name === terminal) done = out;
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          results.push({ type: "tool_result", tool_use_id: u.id, content: e.message, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });

      if (done !== null) {
        const latest = await store.getJob(jobId);
        const result = running.type === "caption" ? latest?.result : done;
        const parsed = parseJobResult(running.type, result);
        if (!parsed.success) return fail(`Terminal tool returned an unexpected shape: ${parsed.error.issues[0]?.message}`);
        const r = parsed.data as Record<string, unknown>;
        await store.updateJob(jobId, {
          status: "completed", result: r, finished_at: new Date().toISOString(), error: null,
          post_id: (r.post_id as string | undefined) ?? running.post_id, article_id: (r.article_id as string | undefined) ?? running.article_id,
        });
        return "completed";
      }
    }
    return fail(`Gave up after ${maxTurns} turns without a successful ${terminal} call`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** Production entry point: real store + Anthropic client, model from app_settings. Never throws. */
export async function runJob(jobId: string): Promise<void> {
  const store = createSupabaseStore();
  const model = (await store.getSetting("ai_model")) ?? DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    await runJobWith(jobId, { store, client, model });
  } catch (e) {
    await store.updateJob(jobId, { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 2000), finished_at: new Date().toISOString() }).catch(() => {});
  }
}
```

Note for the implementer: `messages.stream(...)` returns a `MessageStream`; `finalMessage()` resolves the complete `Message`. `params` typing: use `Anthropic.MessageStreamParams` if `MessageCreateParamsNonStreaming` does not typecheck against `stream()`.

- [ ] **Step 4: Backstop selection (pure) + cron route**

```ts
// src/lib/jobs/backstop.test.ts
import { describe, it, expect } from "vitest";
import { selectStaleJobs } from "@/lib/jobs/backstop";
import { job } from "@/lib/ai/fake-store";

const now = new Date("2026-09-13T12:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();

describe("selectStaleJobs", () => {
  it("runs in_app jobs queued > 60s or running > 10min under the attempt cap", () => {
    const jobs = [
      job({ id: "fresh", created_at: ago(10) }),
      job({ id: "stale-queued", created_at: ago(90) }),
      job({ id: "stuck", status: "running", started_at: ago(700), attempts: 1 }),
      job({ id: "running-ok", status: "running", started_at: ago(60), attempts: 1 }),
      job({ id: "mcp", runner: "mcp", created_at: ago(900) }),
      job({ id: "spent", created_at: ago(900), attempts: 3 }),
    ];
    const r = selectStaleJobs(jobs, now);
    expect(r.run.map((j) => j.id)).toEqual(["stale-queued", "stuck"]);
    expect(r.giveUp.map((j) => j.id)).toEqual(["spent"]);
  });
});
```

```ts
// src/lib/jobs/backstop.ts
import type { Store, StoreJob } from "@/lib/ai/store";

export const QUEUED_STALE_MS = 60_000;
export const RUNNING_STALE_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 3;

export function selectStaleJobs(jobs: StoreJob[], now = new Date()): { run: StoreJob[]; giveUp: StoreJob[] } {
  const run: StoreJob[] = [], giveUp: StoreJob[] = [];
  for (const j of jobs) {
    if (j.runner !== "in_app") continue;
    const staleQueued = j.status === "queued" && now.getTime() - Date.parse(j.created_at) > QUEUED_STALE_MS;
    const staleRunning = j.status === "running" && j.started_at !== null && now.getTime() - Date.parse(j.started_at) > RUNNING_STALE_MS;
    if (!staleQueued && !staleRunning) continue;
    (j.attempts >= MAX_ATTEMPTS ? giveUp : run).push(j);
  }
  return { run, giveUp };
}

/** One tick: give up on spent jobs, re-queue stuck ones, then run stale ones sequentially. */
export async function runBackstop(store: Store, run: (id: string) => Promise<void>, now = new Date()): Promise<{ ran: string[]; gaveUp: string[] }> {
  const [queued, running] = await Promise.all([store.listJobs({ status: "queued", runner: "in_app" }), store.listJobs({ status: "running", runner: "in_app" })]);
  const sel = selectStaleJobs([...queued, ...running], now);
  for (const j of sel.giveUp) await store.updateJob(j.id, { status: "failed", error: `Gave up after ${MAX_ATTEMPTS} attempts`, finished_at: now.toISOString() });
  for (const j of sel.run) {
    if (j.status === "running") await store.transitionJob(j.id, ["running"], { status: "queued", started_at: null });
    await run(j.id);
  }
  return { ran: sel.run.map((j) => j.id), gaveUp: sel.giveUp.map((j) => j.id) };
}
```

```ts
// src/app/api/cron/jobs/route.ts
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { createSupabaseStore } from "@/lib/ai/store";
import { runBackstop } from "@/lib/jobs/backstop";
import { runJob } from "@/lib/ai/runner";

export const maxDuration = 300;

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runBackstop(createSupabaseStore(), runJob));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
export const GET = POST;
```

- [ ] **Step 5: Server actions + queries + status API**

```ts
// src/lib/jobs/queries.ts
import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type GenerationJob = Database["public"]["Tables"]["generation_jobs"]["Row"];

export async function listJobsForBrand(brandId: string): Promise<GenerationJob[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("generation_jobs").select("*").eq("brand_id", brandId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data;
}

export async function getJobPublic(id: string): Promise<Pick<GenerationJob, "id" | "status" | "result" | "error" | "post_id" | "article_id"> | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("generation_jobs").select("id,status,result,error,post_id,article_id").eq("id", id).maybeSingle();
  return data ?? null;
}

export async function countJobsByStatus(brandIds: string[]): Promise<Record<string, { running: number; failed: number }>> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("generation_jobs").select("brand_id,status").in("brand_id", brandIds).in("status", ["queued", "claimed", "running", "failed"]);
  const out: Record<string, { running: number; failed: number }> = {};
  for (const r of data ?? []) {
    out[r.brand_id] ??= { running: 0, failed: 0 };
    if (r.status === "failed") out[r.brand_id].failed++;
    else out[r.brand_id].running++;
  }
  return out;
}
```

```ts
// src/lib/jobs/actions.ts
"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseJobInput, type JobType, type JobRunner } from "@/lib/ai/schemas";
import { runJob } from "@/lib/ai/runner";
import type { Json } from "@/lib/database.types";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

function refresh() {
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
}

export async function enqueueJob(args: { brandId: string; type: JobType; input: unknown; runner?: JobRunner }): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = parseJobInput(args.type, args.input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid job input" };
  const runner = args.runner ?? "in_app";
  const input = parsed.data as Record<string, unknown>;
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({ brand_id: args.brandId, type: args.type, input: input as Json, runner, created_by: user.id, post_id: (input.post_id as string | undefined) ?? null, article_id: (input.article_id as string | undefined) ?? null })
    .select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not queue job" };
  if (runner === "in_app") after(() => runJob(data.id));
  refresh();
  return { ok: true, id: data.id };
}

export async function retryJob(id: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { data: j } = await supabase.from("generation_jobs").select("id,status,runner,error,result").eq("id", id).maybeSingle();
  if (!j) return { ok: false, error: "Job not found" };
  if (j.status !== "failed") return { ok: false, error: "Only failed jobs can be retried" };
  const previous = j.error ? { previous_error: j.error } : {};
  const { error } = await supabase.from("generation_jobs").update({ status: "queued", error: null, finished_at: null, started_at: null, result: previous as Json }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (j.runner === "in_app") after(() => runJob(id));
  refresh();
  return { ok: true, id };
}

export async function cancelJob(id: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("generation_jobs").update({ status: "failed", error: "Cancelled", finished_at: new Date().toISOString() }).eq("id", id).eq("status", "queued").select("id").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Only queued jobs can be cancelled" };
  refresh();
  return { ok: true, id };
}
```

```ts
// src/app/api/jobs/[id]/route.ts
import { NextResponse } from "next/server";
import { getJobPublic } from "@/lib/jobs/queries";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJobPublic(id); // RLS: anonymous gets nothing
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
}
```

Server actions and pages that call `enqueueJob` need `export const maxDuration = 300;` on the page/route file that hosts them (Next applies segment config per route). Add it to `src/app/(app)/posts/[id]/page.tsx`, `src/app/(app)/posts/new/page.tsx`, `src/app/(app)/articles/page.tsx`, `src/app/(app)/articles/[id]/page.tsx`, and `src/app/(app)/jobs/page.tsx` (Task 8).

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run src/lib && npm run typecheck && npm run lint`
Expected: pass.

```bash
git add src/lib/ai/prompts src/lib/ai/runner.ts src/lib/ai/runner.test.ts src/lib/jobs src/app/api/cron/jobs src/app/api/jobs
git commit -m "feat(ai): in-app runner, enqueue/retry/cancel, cron backstop, job status API"
```

---

### Task 8: Jobs page, dashboard tile, sidebar

**Files:**
- Create: `src/app/(app)/jobs/page.tsx`
- Create: `src/components/jobs/jobs-table.tsx`, `src/components/jobs/status-badge.tsx`
- Modify: `src/components/shell/sidebar.tsx` (add `{ href: "/jobs", label: "Jobs" }` after Articles, and `{ href: "/settings", label: "Settings" }` last)
- Modify: `src/lib/dashboard/queries.ts`, `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Status badge + table (client, auto-refresh)**

```tsx
// src/components/jobs/status-badge.tsx
import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/lib/ai/schemas";

const STYLE: Record<JobStatus, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-muted text-foreground" },
  claimed: { label: "Claimed", className: "bg-blue-100 text-blue-900" },
  running: { label: "Running", className: "bg-blue-100 text-blue-900 animate-pulse" },
  completed: { label: "Completed", className: "bg-green-100 text-green-900" },
  failed: { label: "Failed", className: "bg-red-100 text-red-900" },
};
export function JobStatusBadge({ status }: { status: JobStatus }) {
  const s = STYLE[status];
  return <Badge className={s.className}>{s.label}</Badge>;
}
```

```tsx
// src/components/jobs/jobs-table.tsx
"use client";
import Link from "next/link";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { JobStatusBadge } from "./status-badge";
import { retryJob, cancelJob, type ActionResult } from "@/lib/jobs/actions";
import { formatInZone } from "@/lib/time/zoned";
import type { GenerationJob } from "@/lib/jobs/queries";

const TYPE_LABEL = { caption: "Captions", article: "Article", promo: "Promo post", rewrite: "Rewrite" } as const;

function duration(j: GenerationJob): string {
  if (!j.started_at) return "";
  const end = j.finished_at ? Date.parse(j.finished_at) : Date.now();
  return `${Math.round((end - Date.parse(j.started_at)) / 1000)}s`;
}

export function JobsTable({ jobs, timezone }: { jobs: GenerationJob[]; timezone: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = jobs.some((j) => ["queued", "claimed", "running"].includes(j.status));
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [active, router]);
  const run = (fn: () => Promise<ActionResult>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error);
    });
  const output = (j: GenerationJob) =>
    j.article_id ? <Link className="underline" href={`/articles/${j.article_id}`}>Article</Link> : j.post_id ? <Link className="underline" href={`/posts/${j.post_id}`}>Post</Link> : null;
  return (
    <div className="rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr><th className="p-2">Type</th><th className="p-2">Status</th><th className="p-2">Runner</th><th className="p-2">Created</th><th className="p-2">Duration</th><th className="p-2">Tokens</th><th className="p-2">Output</th><th className="p-2">Error</th><th className="p-2"></th></tr>
        </thead>
        <tbody>
          {jobs.length === 0 && <tr><td className="p-3 text-muted-foreground" colSpan={9}>No jobs yet.</td></tr>}
          {jobs.map((j) => (
            <tr key={j.id} className="border-t align-top">
              <td className="p-2 font-medium">{TYPE_LABEL[j.type]}</td>
              <td className="p-2"><JobStatusBadge status={j.status} /></td>
              <td className="p-2">{j.runner === "mcp" ? "MCP" : "In-app"}</td>
              <td className="p-2">{formatInZone(j.created_at, timezone)}</td>
              <td className="p-2">{duration(j)}</td>
              <td className="p-2">{j.input_tokens != null ? `${j.input_tokens} / ${j.output_tokens ?? 0}` : ""}</td>
              <td className="p-2">{output(j)}</td>
              <td className="max-w-xs p-2 text-destructive" title={j.error ?? undefined}>{j.error ? (j.error.length > 80 ? j.error.slice(0, 80) + "…" : j.error) : ""}</td>
              <td className="p-2">
                {j.status === "failed" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryJob(j.id), "Re-queued")}>Retry</Button>}
                {j.status === "queued" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelJob(j.id), "Cancelled")}>Cancel</Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Page**

```tsx
// src/app/(app)/jobs/page.tsx
import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { listJobsForBrand } from "@/lib/jobs/queries";
import { JobsTable } from "@/components/jobs/jobs-table";

export const metadata = { title: "Jobs" };
export const maxDuration = 300;

export default async function JobsPage() {
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];
  if (!brand) return <p className="text-muted-foreground">Create a brand first. <Link className="underline" href="/brands/new">New brand</Link></p>;
  const jobs = await listJobsForBrand(brand.id);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Generation jobs</h1>
        <p className="text-sm text-muted-foreground">{brand.name}. In-app jobs run automatically; MCP jobs wait for an external Claude session (see Settings).</p>
      </div>
      <JobsTable jobs={jobs} timezone={brand.timezone} />
    </div>
  );
}
```

- [ ] **Step 3: Dashboard counts**

In `src/lib/dashboard/queries.ts`: add `jobs: { running: number; failed: number }` to `DashboardBrand`; import `countJobsByStatus` from `@/lib/jobs/queries`; call `const jobCounts = await countJobsByStatus(ids);` alongside the existing `Promise.all`; in the map add `jobs: jobCounts[b.id] ?? { running: 0, failed: 0 }`.

In `src/app/(app)/dashboard/page.tsx`, next to the pending-approval line add:

```tsx
{(b.jobs.running > 0 || b.jobs.failed > 0) && (
  <Link href="/jobs" className="text-xs underline">
    {b.jobs.running} job{b.jobs.running === 1 ? "" : "s"} running · {b.jobs.failed} failed
  </Link>
)}
```

- [ ] **Step 4: Verify, e2e-less smoke, commit**

Run: `npm run typecheck && npm run lint && npm test`; open `http://localhost:3000/jobs` — renders "No jobs yet."

```bash
git add src/app/\(app\)/jobs src/components/jobs src/components/shell/sidebar.tsx src/lib/dashboard/queries.ts src/app/\(app\)/dashboard/page.tsx
git commit -m "feat(jobs): jobs page, dashboard counts, sidebar"
```

---

### Task 9: Composer "Write captions", category select, Recycle → rewrite job

**Files:**
- Create: `src/components/posts/generate-captions.tsx`
- Create: `src/lib/categories/queries.ts`
- Modify: `src/components/posts/post-form.tsx`
- Modify: `src/lib/posts/schema.ts`, `src/lib/posts/actions.ts` (category_id)
- Modify: `src/app/(app)/posts/new/page.tsx`, `src/app/(app)/posts/[id]/page.tsx` (pass categories; `maxDuration`)
- Modify: `src/components/posts/post-actions.tsx` (Recycle → `enqueueJob` rewrite)

**Interfaces:**
- `listCategories(brandId): Promise<PostCategory[]>` (server supabase).
- `GenerateCaptions` props: `{ postId?: string; brandId: string; savePayload: () => Promise<string | null>; onResult(r: { captions: { facebook: string; instagram: string }; category_slug?: string }): void }`.

- [ ] **Step 1: Categories query + schema/action changes**

```ts
// src/lib/categories/queries.ts
import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type PostCategory = Database["public"]["Tables"]["post_categories"]["Row"];

export async function listCategories(brandId: string): Promise<PostCategory[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("post_categories").select("*").eq("brand_id", brandId).order("sort_order");
  if (error) throw new Error(error.message);
  return data.map((c) => ({ ...c, target_share: Number(c.target_share) }));
}
```

In `src/lib/posts/schema.ts` add to `postFormSchema`: `category_id: z.string().uuid().nullable().default(null),`. In `src/lib/posts/actions.ts` `savePost`, include `category_id: input.category_id` in both the `update({...})` and `insert({...})` objects. Add a test to `src/lib/posts/schema.test.ts` (create if absent):

```ts
it("accepts an optional category_id", () => {
  const base = { brand_id: "3f5c1c1e-1b9a-4c1e-9a1e-1b9a4c1e9a1e", title: "t", link_url: "", media: [], targets: [{ platform: "facebook", enabled: true, caption: "", scheduled_local: "" }, { platform: "instagram", enabled: false, caption: "", scheduled_local: "" }] };
  expect(postFormSchema.parse(base).category_id).toBeNull();
  expect(postFormSchema.parse({ ...base, category_id: "3f5c1c1e-1b9a-4c1e-9a1e-1b9a4c1e9a1e" }).category_id).toBe("3f5c1c1e-1b9a-4c1e-9a1e-1b9a4c1e9a1e");
});
```

- [ ] **Step 2: GenerateCaptions component**

```tsx
// src/components/posts/generate-captions.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { enqueueJob } from "@/lib/jobs/actions";
import type { CaptionResult } from "@/lib/ai/schemas";

type Props = { brandId: string; ensureSaved: () => Promise<string | null>; onResult: (r: CaptionResult) => void };

/** "Write captions": saves the draft, queues a caption job, polls it, and hands the captions back to the form. */
export function GenerateCaptions({ brandId, ensureSaved, onResult }: Props) {
  const [jobId, setJobId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!jobId) return;
    timer.current = setInterval(async () => {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { status: string; result: CaptionResult | null; error: string | null };
      if (j.status === "completed" && j.result) { onResult(j.result); toast.success("Captions written — review before submitting"); setJobId(null); }
      if (j.status === "failed") { toast.error(j.error ?? "Caption job failed"); setJobId(null); }
    }, 2000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [jobId, onResult]);

  const start = async () => {
    const postId = await ensureSaved();
    if (!postId) return;
    const r = await enqueueJob({ brandId, type: "caption", input: { post_id: postId } });
    if (!r.ok) return void toast.error(r.error);
    setJobId(r.id!);
  };
  return (
    <Button type="button" variant="outline" disabled={!!jobId} onClick={start}>
      {jobId ? "Writing captions…" : "✨ Write captions"}
    </Button>
  );
}
```

- [ ] **Step 3: Wire into PostForm**

In `src/components/posts/post-form.tsx`:
- Add props `categories: PostCategory[]` (import type from `@/lib/categories/queries`).
- State: `const [categoryId, setCategoryId] = useState<string | null>(post?.category_id ?? null);` and include `category_id: categoryId` in `payload`.
- Add a category `Select` beside the link field (only when `categories.length > 0`):

```tsx
<div className="space-y-1">
  <Label>Category</Label>
  <Select value={categoryId ?? ""} onValueChange={(v) => setCategoryId(v || null)}>
    <SelectTrigger><SelectValue placeholder="Uncategorized" /></SelectTrigger>
    <SelectContent>
      {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
    </SelectContent>
  </Select>
</div>
```

- `ensureSaved`: the form already submits via `useActionState`; to get an id without a page navigation, call `savePost(null, fd)` directly:

```ts
const ensureSaved = async (): Promise<string | null> => {
  const fd = new FormData();
  fd.set("payload", payload);
  const r = await savePost(null, fd);
  if (!r.ok) { toast.error(r.error); return null; }
  if (!post && r.id) router.replace(`/posts/${r.id}`);
  return r.id ?? null;
};
```

(When the draft is new, `router.replace` moves to the edit page; the `GenerateCaptions` component keeps polling because it lives in the same client tree only until navigation — so for a **new** post, show the button only after first save: render `<GenerateCaptions>` when `post?.id` exists, and show a hint "Save the draft to write captions" otherwise. This keeps the flow simple and reliable.)

- `onResult`: `setTargets(ts => ts.map(t => ({ ...t, caption: r.captions[t.platform] })))`; if `r.category_slug`, `setCategoryId(categories.find(c => c.slug === r.category_slug)?.id ?? categoryId)`.
- Render the button above the captions grid, next to the existing "Copy from Facebook" control.

Pass `categories={await listCategories(brand.id)}` from both post pages and add `export const maxDuration = 300;` to each.

- [ ] **Step 4: Recycle → rewrite job**

In `src/components/posts/post-actions.tsx`, replace the Recycle handler body with:

```ts
start(async () => {
  const r = await enqueueJob({ brandId: post.brand_id, type: "rewrite", input: { post_id: post.id } });
  if (r.ok) { toast.success("Rewrite queued — see Jobs"); router.push("/jobs"); } else toast.error(r.error);
})
```

and relabel the button "Recycle with AI". Keep `recyclePost` exported for the tests that use it (no test does — remove the import if lint flags it unused).

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test`; in the browser: open an existing draft post, click "✨ Write captions" → button shows "Writing captions…" and, with a valid `ANTHROPIC_API_KEY`, fills both captions within ~30s.

```bash
git add src/components/posts src/lib/categories src/lib/posts src/app/\(app\)/posts
git commit -m "feat(posts): AI captions in composer, category select, recycle as rewrite job"
```

---

### Task 10: Articles — "New from brief" and "Promote on social"

**Files:**
- Create: `src/components/articles/new-from-brief.tsx`
- Modify: `src/app/(app)/articles/page.tsx` (button + `maxDuration`)
- Modify: `src/components/articles/article-actions.tsx` (Promote button)
- Modify: `src/app/(app)/articles/[id]/page.tsx` (`maxDuration`)

- [ ] **Step 1: Dialog component**

```tsx
// src/components/articles/new-from-brief.tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { enqueueJob } from "@/lib/jobs/actions";

export function NewFromBrief({ brandId }: { brandId: string }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [decision, setDecision] = useState<"new" | "rewrite" | "optimize">("new");
  const [notes, setNotes] = useState("");
  const [runner, setRunner] = useState<"in_app" | "mcp">("in_app");
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () =>
    start(async () => {
      const r = await enqueueJob({
        brandId, type: "article", runner,
        input: { topic, primary_keyword: primary || undefined, secondary_keywords: secondary.split(",").map((s) => s.trim()).filter(Boolean), decision, notes: notes || undefined },
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(runner === "mcp" ? "Queued for MCP — claim it from a Claude session" : "Writing article — see Jobs");
      setOpen(false);
      router.push("/jobs");
    });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>✨ New from brief</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Write an article with AI</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="topic">Topic</Label><Input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="How to stain a cedar deck in Spokane" /></div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="pk">Primary keyword</Label><Input id="pk" value={primary} onChange={(e) => setPrimary(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="sk">Secondary keywords (comma separated)</Label><Input id="sk" value={secondary} onChange={(e) => setSecondary(e.target.value)} /></div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Decision</Label>
                <Select value={decision} onValueChange={(v) => setDecision(v as typeof decision)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="new">New article</SelectItem><SelectItem value="rewrite">Rewrite</SelectItem><SelectItem value="optimize">Optimize</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Runner</Label>
                <Select value={runner} onValueChange={(v) => setRunner(v as typeof runner)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="in_app">In-app (Claude API)</SelectItem><SelectItem value="mcp">Queue for MCP</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1"><Label htmlFor="notes">Notes</Label><Textarea id="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Angle, must-mention points, links to include…" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={pending || topic.trim().length < 3} onClick={submit}>{pending ? "Queuing…" : "Write article"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: Wire into the list page and article actions**

In `src/app/(app)/articles/page.tsx` add `export const maxDuration = 300;`, import `NewFromBrief`, and render `<NewFromBrief brandId={brand.id} />` beside the "New article" button (wrap both in `<div className="flex gap-2">`).

In `src/components/articles/article-actions.tsx` add, when `s === "pushed_to_wp" || s === "published"`:

```tsx
<Button variant="outline" disabled={pending} onClick={() => start(async () => {
  const r = await enqueueJob({ brandId: article.brand_id, type: "promo", input: { article_id: article.id, scheduled_after: article.published_at ?? new Date().toISOString() } });
  if (r.ok) { toast.success("Promo post queued — see Jobs"); router.push("/jobs"); } else toast.error(r.error);
})}>Promote on social</Button>
```

(import `enqueueJob` from `@/lib/jobs/actions`). Add `export const maxDuration = 300;` to `src/app/(app)/articles/[id]/page.tsx`.

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test`; in the browser: Articles → "✨ New from brief" → runner "Queue for MCP" → job appears on `/jobs` as Queued; Cancel works.

```bash
git add src/components/articles src/app/\(app\)/articles
git commit -m "feat(articles): new-from-brief and promote-on-social jobs"
```

---

### Task 11: Brand content-mix tab and Settings page

**Files:**
- Create: `src/lib/categories/actions.ts`, `src/lib/categories/schema.ts`, `src/lib/categories/schema.test.ts`
- Create: `src/app/(app)/brands/[slug]/content-mix/page.tsx`, `src/components/brands/category-editor.tsx`
- Modify: `src/app/(app)/brands/[slug]/brand-nav.tsx` (add "Content mix" tab)
- Create: `src/app/(app)/settings/page.tsx`, `src/components/settings/ai-model-select.tsx`, `src/lib/settings/actions.ts`, `src/lib/settings/queries.ts`

- [ ] **Step 1: Category schema (pure) + test**

```ts
// src/lib/categories/schema.ts
import { z } from "zod";
import { slugify } from "@/lib/brands/schema";

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  target_percent: z.coerce.number().min(0).max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  sort_order: z.coerce.number().int().min(0).default(0),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export function toRow(i: CategoryInput) {
  return { name: i.name, slug: slugify(i.name), target_share: i.target_percent / 100, description: i.description || null, sort_order: i.sort_order };
}
/** Sum of targets (0–1) must stay ≤ 1 after applying a change. Returns an error string or null. */
export function checkTotal(existing: { id: string; target_share: number }[], next: { id?: string; target_share: number }): string | null {
  const total = existing.filter((c) => c.id !== next.id).reduce((s, c) => s + Number(c.target_share), 0) + next.target_share;
  return total > 1.0001 ? `Targets add up to ${Math.round(total * 100)}%; they must total 100% or less` : null;
}
```

```ts
// src/lib/categories/schema.test.ts
import { describe, it, expect } from "vitest";
import { categoryInputSchema, toRow, checkTotal } from "@/lib/categories/schema";

describe("category schema", () => {
  it("slugifies and converts percent to share", () => {
    expect(toRow(categoryInputSchema.parse({ name: "Project Showcase", target_percent: "40" }))).toMatchObject({ slug: "project-showcase", target_share: 0.4, description: null });
  });
  it("rejects totals over 100%", () => {
    expect(checkTotal([{ id: "a", target_share: 0.7 }], { target_share: 0.4 })).toMatch(/110%/);
    expect(checkTotal([{ id: "a", target_share: 0.7 }], { id: "a", target_share: 0.4 })).toBeNull();
  });
});
```

- [ ] **Step 2: Actions**

```ts
// src/lib/categories/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { categoryInputSchema, toRow, checkTotal } from "./schema";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function guard() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { supabase } : null;
}

export async function saveCategory(brandId: string, id: string | null, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const g = await guard();
  if (!g) return { ok: false, error: "Not signed in" };
  const parsed = categoryInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid category" };
  const row = toRow(parsed.data);
  const { data: existing } = await g.supabase.from("post_categories").select("id,target_share").eq("brand_id", brandId);
  const err = checkTotal((existing ?? []).map((c) => ({ id: c.id, target_share: Number(c.target_share) })), { id: id ?? undefined, target_share: row.target_share });
  if (err) return { ok: false, error: err };
  const q = id ? g.supabase.from("post_categories").update(row).eq("id", id) : g.supabase.from("post_categories").insert({ ...row, brand_id: brandId });
  const { error } = await q;
  if (error) return { ok: false, error: error.message.includes("unique") ? "A category with that name already exists" : error.message };
  revalidatePath("/brands", "layout");
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g) return { ok: false, error: "Not signed in" };
  const { error } = await g.supabase.from("post_categories").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/brands", "layout");
  return { ok: true };
}
```

- [ ] **Step 3: Content-mix page + editor**

```tsx
// src/app/(app)/brands/[slug]/content-mix/page.tsx
import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands/queries";
import { listCategories } from "@/lib/categories/queries";
import { createSupabaseStore } from "@/lib/ai/store";
import { computeContentMix } from "@/lib/ai/content-mix";
import { BrandNav } from "../brand-nav";
import { CategoryEditor } from "@/components/brands/category-editor";

export default async function ContentMixPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const categories = await listCategories(brand.id);
  const mix = computeContentMix(categories, await createSupabaseStore().listRecentCategorizedPosts(brand.id));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{brand.name}</h1>
      <BrandNav slug={slug} />
      <p className="text-sm text-muted-foreground">Target share of each post category. The generator favours whichever category is furthest under target across the last {mix.window} approved/published posts ({mix.total} so far).</p>
      <CategoryEditor brandId={brand.id} categories={categories} mix={mix} />
    </div>
  );
}
```

```tsx
// src/components/brands/category-editor.tsx
"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCategory, deleteCategory, type ActionResult } from "@/lib/categories/actions";
import type { PostCategory } from "@/lib/categories/queries";
import type { ContentMix } from "@/lib/ai/content-mix";

function Row({ brandId, c, actual }: { brandId: string; c: PostCategory | null; actual: number | null }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveCategory.bind(null, brandId, c?.id ?? null), null);
  const router = useRouter();
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!state) return;
    if (state.ok) { toast.success("Saved"); router.refresh(); if (!c) setKey((k) => k + 1); } else toast.error(state.error);
  }, [state, router, c]);
  return (
    <form key={key} action={action} className="grid items-end gap-2 rounded-lg border p-3 md:grid-cols-[1fr_100px_2fr_80px_auto]">
      <div className="space-y-1"><Label>Name</Label><Input name="name" defaultValue={c?.name ?? ""} required /></div>
      <div className="space-y-1"><Label>Target %</Label><Input name="target_percent" type="number" min={0} max={100} defaultValue={c ? Math.round(c.target_share * 100) : ""} required /></div>
      <div className="space-y-1"><Label>What qualifies</Label><Input name="description" defaultValue={c?.description ?? ""} placeholder="Shown to the generator" /></div>
      <div className="space-y-1"><Label>Order</Label><Input name="sort_order" type="number" min={0} defaultValue={c?.sort_order ?? 0} /></div>
      <div className="flex gap-1">
        <Button size="sm" disabled={pending} type="submit">{c ? "Save" : "Add"}</Button>
        {c && <Button size="sm" variant="ghost" type="button" onClick={async () => { const r = await deleteCategory(c.id); if (r.ok) router.refresh(); else toast.error(r.error); }}>Delete</Button>}
      </div>
      {c && actual !== null && (
        <div className="md:col-span-5">
          <div className="h-2 w-full rounded bg-muted"><div className="h-2 rounded bg-foreground" style={{ width: `${Math.min(100, Math.round(actual * 100))}%` }} /></div>
          <p className="mt-1 text-xs text-muted-foreground">Actual {Math.round(actual * 100)}% · target {Math.round(c.target_share * 100)}%</p>
        </div>
      )}
    </form>
  );
}

export function CategoryEditor({ brandId, categories, mix }: { brandId: string; categories: PostCategory[]; mix: ContentMix }) {
  const actualFor = (id: string) => mix.categories.find((m) => m.id === id)?.actual_share ?? 0;
  return (
    <div className="space-y-3">
      {categories.map((c) => <Row key={c.id} brandId={brandId} c={c} actual={actualFor(c.id)} />)}
      <Row brandId={brandId} c={null} actual={null} />
      {mix.favour_next && <p className="text-sm">Next post should favour: <span className="font-medium">{mix.favour_next}</span></p>}
    </div>
  );
}
```

Add `{ href: \`/brands/${slug}/content-mix\`, label: "Content mix" }` to `brand-nav.tsx` tabs.

- [ ] **Step 4: Settings page (AI model + MCP card)**

```ts
// src/lib/settings/queries.ts
import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
export async function getSetting(key: string): Promise<string | null> {
  const { data } = await createAdminSupabase().from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
```

```ts
// src/lib/settings/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const AI_MODELS = ["claude-opus-5", "claude-sonnet-5"] as const;
export type ActionResult = { ok: true } | { ok: false; error: string };

export async function setAiModel(model: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(AI_MODELS as readonly string[]).includes(model)) return { ok: false, error: "Unknown model" };
  const { error } = await createAdminSupabase().from("app_settings").upsert({ key: "ai_model", value: model });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}
```

```tsx
// src/components/settings/ai-model-select.tsx
"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setAiModel, AI_MODELS } from "@/lib/settings/actions";

export function AiModelSelect({ value }: { value: string }) {
  const [pending, start] = useTransition();
  return (
    <Select value={value} disabled={pending} onValueChange={(v) => start(async () => { const r = await setAiModel(v); if (r.ok) toast.success("Model updated"); else toast.error(r.error); })}>
      <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
      <SelectContent>{AI_MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
    </Select>
  );
}
```

```tsx
// src/app/(app)/settings/page.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AiModelSelect } from "@/components/settings/ai-model-select";
import { getSetting } from "@/lib/settings/queries";
import { DEFAULT_MODEL } from "@/lib/ai/runner";
import { env } from "@/lib/env";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const model = (await getSetting("ai_model")) ?? DEFAULT_MODEL;
  const mcpUrl = `${env.NEXT_PUBLIC_APP_URL}/api/mcp`;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">AI generation</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">Model used by in-app jobs. Anthropic key: {env.ANTHROPIC_API_KEY ? "configured" : "missing"}.</p>
          <AiModelSelect value={model} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">MCP server</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Connect a Claude session to write directly into this app. URL: <code>{mcpUrl}</code>. Token: the <code>MCP_TOKEN</code> environment variable (not shown here).</p>
          <p className="font-medium">Claude Code</p>
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{`claude mcp add --transport http jamsam ${mcpUrl} --header "Authorization: Bearer $MCP_TOKEN"`}</pre>
          <p className="font-medium">Claude.ai</p>
          <p>Settings → Connectors → Add custom connector → URL above; when asked for authentication, paste the token as a Bearer token.</p>
          <p className="text-muted-foreground">Jobs created with runner "Queue for MCP" wait on <code>list_jobs</code> until a connected session claims them.</p>
        </CardContent>
      </Card>
    </div>
  );
}
```

`DEFAULT_MODEL` lives in `runner.ts` which imports `server-only`; the settings page is a Server Component so that is fine.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test`; browser: Brand → Content mix → add "Projects 50%", "Tips 30%", "Credibility 20%"; adding a 4th at 10% errors "Targets add up to 110%". Settings page shows the model select and MCP card.

```bash
git add src/lib/categories src/lib/settings src/app/\(app\)/brands src/app/\(app\)/settings src/components/brands/category-editor.tsx src/components/settings
git commit -m "feat(ai): content-mix categories tab and settings page"
```

---

### Task 12: E2E test, teardown, live verification, deploy, merge

**Files:**
- Create: `e2e/jobs.spec.ts`
- Modify: `e2e/global-teardown.ts`

- [ ] **Step 1: E2E (no API key needed — MCP runner never executes)**

```ts
// e2e/jobs.spec.ts
import { test, expect } from "@playwright/test";

test("content-mix category, queue an MCP article job, cancel it", async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL, "E2E_EMAIL / E2E_PASSWORD not set");
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  // Category on the current brand
  await page.goto("/brands");
  await page.getByRole("link").filter({ hasText: /./ }).nth(0);
  await page.locator("a[href^='/brands/']").first().click();
  await page.getByRole("link", { name: "Content mix" }).click();
  const catName = `E2E cat ${Date.now()}`;
  const newRow = page.locator("form").last();
  await newRow.getByLabel("Name").fill(catName);
  await newRow.getByLabel("Target %").fill("5");
  await newRow.getByRole("button", { name: "Add" }).click();
  await expect(page.getByDisplayValue(catName)).toBeVisible();

  // Queue an MCP job from the articles page
  await page.goto("/articles");
  await page.getByRole("button", { name: /New from brief/ }).click();
  const topic = `E2E topic ${Date.now()}`;
  await page.getByLabel("Topic").fill(topic);
  await page.getByText("In-app (Claude API)").click();
  await page.getByRole("option", { name: "Queue for MCP" }).click();
  await page.getByRole("button", { name: "Write article" }).click();
  await expect(page).toHaveURL(/\/jobs/);
  const row = page.getByRole("row").filter({ hasText: "Article" }).filter({ hasText: "Queued" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Cancelled" }).first()).toBeVisible();

  // Clean the category
  await page.goto("/brands");
  await page.locator("a[href^='/brands/']").first().click();
  await page.getByRole("link", { name: "Content mix" }).click();
  const form = page.locator("form").filter({ has: page.getByDisplayValue(catName) });
  await form.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByDisplayValue(catName)).toHaveCount(0);
});
```

Add to `e2e/global-teardown.ts`:

```ts
  await fetch(`${url}/rest/v1/generation_jobs?input->>topic=like.E2E%20topic%20*`, { method: "DELETE", headers });
  await fetch(`${url}/rest/v1/post_categories?name=like.E2E%20cat%20*`, { method: "DELETE", headers });
```

Run: `npm run e2e` → 5 passed.

- [ ] **Step 2: Live verification (needs `ANTHROPIC_API_KEY` in `.env.local`)**

1. Brand JamSam Digital → Content mix: add 2–3 categories.
2. Posts → open/create a draft with an image + title → "✨ Write captions" → captions land in both fields, category selected; Jobs page shows the completed job with tokens.
3. Articles → "✨ New from brief" (in-app) with a real topic → job completes in < 3 min → article draft has featured image, body images, SEO fields → Push to WordPress (Phase 3) succeeds.
4. Article page → "Promote on social" → pending post with the article link and featured image.
5. Kill switch check: create an in-app job, immediately stop `next dev` (simulates a lost `after()`), restart, call `curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/jobs` after 60s → job is picked up and completes.
6. MCP: `claude mcp add --transport http jamsam http://localhost:3000/api/mcp --header "Authorization: Bearer <MCP_TOKEN>"`, then in a Claude Code session: "list jamsam jobs, claim the queued one and complete it" on an MCP-runner caption job → job shows Completed with `claimed_by` = the client name.

- [ ] **Step 3: Full checks, deploy, PR, merge**

```bash
npm run typecheck && npm run lint && npm test && npm run e2e
npx vercel env add ANTHROPIC_API_KEY production   # if not already
npx vercel env add MCP_TOKEN production
npx vercel deploy --prod --yes
git push -u origin phase-4-ai
gh pr create --base main --head phase-4-ai --title "Phase 4: AI layer (jobs queue, MCP server, in-app generation, content mix)" --body "…summary + live verification checklist…"
```

Wait for CI, then `gh pr merge <n> --squash`. Re-run the MCP add against the prod URL and confirm `tools/list` works there too (Vercel SSO protection is previews-only, so prod is reachable).

---

## Self-review

**Spec coverage:** data model (T1) · job input/result shapes (T2) · content mix maths + window + favour_next (T2) · settings/env (T1, T11) · every tool in the spec table incl. `submit_captions`, `update_article`, queue tools MCP-only (T4–T5) · hard rules in code (T2, T5) · MCP route stateless + bearer + 405 (T6) · runner loop, terminal tools, limits, retries, no partial records (T7) · kick-off with `after()`, backstop cron, retry semantics (T7) · composer button + polling + category select + recycle (T9) · new-from-brief + promote (T10) · jobs page, dashboard tile, content-mix tab, settings page with MCP card (T8, T11) · prompts per type (T5 instructions + T7 system) · tests: unit, MCP in-process, e2e, live (T2–T12).

**Placeholder scan:** none; every step has concrete code. The PR body in T12 is the only free text the implementer writes.

**Type consistency:** `Store` method names in T3 are the only names used by T4–T7 and T11 (`listRecentCategorizedPosts`, `transitionJob`, `updateJob`, `getSetting`, …). `TERMINAL_TOOL` (T2) is used by the runner (T7). `CaptionResult` (T2) is used by `GenerateCaptions` (T9). `enqueueJob` signature `{ brandId, type, input, runner? }` is identical in T7, T9, T10. `computeContentMix(categories, posts)` argument order is the same in T2, T4, T11.
