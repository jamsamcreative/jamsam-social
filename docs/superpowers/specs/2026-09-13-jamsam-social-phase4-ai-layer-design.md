# JamSam Social — Phase 4: AI layer

**Date:** 2026-09-13
**Status:** Approved in conversation; written for execution
**Builds on:** Phase 1 (brands, guidelines, media), Phase 2 (posts, approval, publisher, cron), Phase 3 (articles → WordPress)

## Purpose

Let Claude write social captions, blog articles, blog-promo posts, and post rewrites for a brand, following that brand's guideline documents and a per-brand content mix. Generation runs two ways from one queue: **in-app** (the app calls the Claude API itself — the day-to-day path) and **MCP** (an external Claude session connected to the app's MCP server does the writing — for bulk or bespoke runs). Both use the same tool implementations so they cannot drift.

## Decisions carried from brainstorming

- Runner: **both**, in-app primary. One `generation_jobs` queue; a job's `runner` says who is expected to execute it.
- Job types: **caption**, **article**, **promo** (social post promoting an article), **rewrite** (fresh variant of an existing post's captions).
- Content mix: **per-brand tagged categories** with target shares; posts carry a category; the mix is computed from recent posts and tells the generator which category to favour next.
- MCP auth: **static bearer token** (`MCP_TOKEN` env var).
- Article images: generator picks from the **brand media library** and can **search the brand's WordPress media library**.
- Architecture: **one queue, one tool layer, two thin adapters** (MCP route + in-app agent loop). In-app runs are kicked off with Next.js `after()` and backstopped by the existing pg_cron tick.

## Out of scope

Pinterest (Phase 6), keyword research / cannibalization / content bank (Phase 5), image generation, OAuth for the MCP server, per-user API keys, streaming partial output to the UI, client-facing approval, fine-grained cost budgets beyond a per-job token cap.

## Data model

```sql
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
```

RLS: same policy as every other table — any authenticated user can read/write; the service role is used by the runner and cron.

`post_id` / `article_id` link a job to the record it is *about* (caption, rewrite, promo input) or *produced* (article, promo/rewrite output). For caption jobs the composer saves a draft post first so images, link and title live on the post.

### Job `input` and `result` by type

| type | input | result |
|---|---|---|
| caption | `{ post_id }` | `{ captions: { facebook, instagram }, category_slug }` |
| article | `{ topic, primary_keyword?, secondary_keywords?: string[], decision: 'new'\|'rewrite'\|'optimize', notes? }` | `{ article_id }` |
| promo | `{ article_id, scheduled_after?: ISO }` | `{ post_id }` |
| rewrite | `{ post_id }` | `{ post_id }` (the new draft) |

`input` is validated with a zod schema per type at enqueue time and again by the runner.

### Content mix (computed, not stored)

For a brand: take the most recent 20 posts with status `approved`, `publishing`, `published` (any target). Group by `category_id`; `actual = count / total`. Posts with no category count in the denominator only. `favour_next` is the category with the largest `target_share − actual` (ties → lower `sort_order`). If the brand has no categories, the mix is empty and generators ignore it. Target shares are edited per brand and must sum to ≤ 1.

### Settings and env

- `app_settings.ai_model` (default `claude-sonnet-5`), editable in Settings.
- Env: `ANTHROPIC_API_KEY`, `MCP_TOKEN` (≥ 32 random bytes, base64). Both set in Vercel; `.env.local` for dev.

## Shared tool layer — `src/lib/ai/tools/`

One file per tool, each exporting a `Tool`:

```ts
type ToolCtx = { supabase: SupabaseClient<Database>; actor: { kind: 'in_app' | 'mcp'; userId?: string; clientName?: string } };
type Tool<I> = { name: string; description: string; input: z.ZodType<I>; run(ctx: ToolCtx, input: I): Promise<unknown> };
```

`registry.ts` exports `allTools` and `agentTools` (= all minus the queue tools). Tools always identify brands by **slug**.

| Tool | Behaviour |
|---|---|
| `list_brands()` | slug, name, timezone, website, SEO suffix, and which connections are connected. |
| `get_brand_guidelines(brand, kind?)` | Guideline documents (Phase 1) — full markdown. |
| `get_content_mix(brand)` | Categories with `target_share`, `actual_share`, `count`, plus `favour_next` and `window` (20). |
| `list_media_assets(brand, tags?, query?)` | Brand library: `id, url, alt, tags, used_as_featured` (true if any article's `featured_media.url` equals it). |
| `search_wp_media(brand, query, per_page=20)` | Brand's WordPress media library via `GET /wp/v2/media?search=` using the Phase 3 client. Returns `id, source_url, alt_text, title`. Errors clearly if WP isn't connected. |
| `list_articles(brand, status?)` / `get_article(id)` | Phase 3 queries. `get_article` includes `content_html` and the computed public `url` (wp_link or `website/slug/`). |
| `list_posts(brand, status?, limit=20)` | Recent posts with captions and category — reference material for tone and for `rewrite`. |
| `create_post(brand, title, targets[], media_urls?, link_url?, category_slug?, article_id?, source='ai')` | Inserts a post (`status='pending_approval'`, `source='ai'`) and one `post_targets` row per platform (`scheduled_at` optional). Returns `{ post_id }`. |
| `submit_captions(job_id, captions{facebook,instagram}, category_slug?)` | Terminal tool for **caption** jobs only: writes the job result; creates nothing. |
| `create_article(brand, title, slug, content_html, excerpt?, seo_title?, meta_description?, primary_keyword?, secondary_keywords?, featured_media_url, featured_alt, categories?, tags?, decision, rationale?)` | Inserts an article (`status='draft'`, `source='ai'`). `featured_media_url` may be any public URL; Phase 3 push re-hosts it. Returns `{ article_id }`. |
| `update_article(id, patch)` | Partial update of the same fields. |
| `list_jobs(brand?, status='queued')` | Queue tools — **MCP only**. Only jobs with `runner='mcp'` are listed. |
| `claim_job(job_id)` | Atomic `queued → claimed` (`update … where status='queued'`; 0 rows → error "already claimed"). Sets `claimed_by` to the MCP client name. Returns `{ job, brief }` where `brief` = the resolved context the runner would build: the post or article record, guideline docs, content mix, media list, and the type-specific instructions. |
| `complete_job(job_id, result?, error?)` | `claimed/running → completed` with `result`, or `→ failed` with `error`. Validates `result` against the type's result schema. |

Hard rules enforced in `run()` (not just prompts): `create_post` and `submit_captions` run the **caption validator** — no em/en dashes, no "actually", contractions present (heuristic: at least one apostrophe-contraction per 40 words), platform length limits (IG 2,200, FB 5,000). Violations return an error listing them so the agent fixes and retries. `create_article` warns (in the return value, never rejects) when `seo_title` lacks the brand suffix or `meta_description` is outside 120–156 chars, and rejects a body with `data:` image URLs.

## Adapters

### MCP route — `src/app/api/mcp/route.ts`

- `@modelcontextprotocol/sdk` `McpServer` + `WebStandardStreamableHTTPServerTransport` in **stateless** mode (a fresh server per request, no session ids). `POST` only; `GET`/`DELETE` return 405.
- Auth: `Authorization: Bearer <MCP_TOKEN>` compared in constant time; missing/wrong → 401 with `WWW-Authenticate: Bearer`.
- Registers every tool in `allTools` with its zod input schema; `ToolCtx.actor = { kind: 'mcp', clientName }` from the initialize params when present.
- `export const maxDuration = 60`.
- Settings page shows the URL (`${NEXT_PUBLIC_APP_URL}/api/mcp`) and copy-paste setup for Claude Code (`claude mcp add --transport http jamsam <url> --header "Authorization: Bearer …"`) and Claude.ai custom connectors. The token itself is not displayed.

### In-app runner — `src/lib/ai/runner.ts`

- `runJob(jobId)`: atomic `queued → running` (0 rows → return; another runner has it), `attempts += 1`, `started_at`. Builds `brief` (same builder `claim_job` uses), then runs a tool-use loop with the Anthropic SDK: `model = app_settings.ai_model`, tools = `agentTools` mapped to Anthropic tool definitions (zod → JSON Schema), system prompt = brand guidelines + content mix + type instructions, first user message = the brief.
- Loop ends when the type's **terminal tool** succeeds (`submit_captions` for caption; `create_article` for article; `create_post` for promo and rewrite). Other tool calls are executed and fed back. Limits: 20 assistant turns, 150k cumulative input tokens; exceeding either → `failed`.
- On success: `status='completed'`, `result`, `post_id`/`article_id`, `model`, token counts, `finished_at`. On any exception: `status='failed'`, `error` (message, trimmed to 2k chars).
- Anthropic 429/5xx/overloaded: 3 retries with exponential backoff inside the loop before failing.
- Nothing is written to `posts`/`articles` except by the terminal tool, so a failed job leaves no partial records.

### Kick-off and backstop

- `enqueueJob({ brandId, type, input, runner })` server action: validate input, insert the row, and for `in_app` call `after(() => runJob(id))`. Actions/routes that enqueue export `maxDuration = 300`.
- `/api/cron/jobs` (added to the existing pg_cron → pg_net minute tick, same `CRON_SECRET` check as `/api/cron/publish`): runs, one at a time, any `in_app` job that is `queued` for > 60s or `running` for > 10 min, with `attempts < 3`; anything over 3 attempts is marked `failed` ("gave up after 3 attempts"). This handles a killed function or a lost `after()`.
- **Retry** on a failed job resets it to `queued` (`attempts` preserved, `error` kept in `result.previous_error` for reference) and triggers `after(runJob)` again.

## UI

- **Post composer** (Phase 2): "Write captions" button. Saves the draft (creates the post if new), enqueues a caption job, shows a spinner over the caption fields, polls `GET /api/jobs/[id]` every 2s (auth-required route returning `status, result, error`), then fills the FB/IG caption fields and the category select. The user still reviews and submits. A **category select** (brand's `post_categories`) is added next to the title. **Recycle** on a post page enqueues a rewrite job; on completion the page links to the new draft.
- **Articles list**: "New from brief" dialog — topic, primary keyword, secondary keywords, decision, notes, runner (In-app / Queue for MCP). Enqueues an article job; toast links to the Jobs page. **Article page**: "Promote on social" (enabled when `pushed_to_wp` or `published`) enqueues a promo job with `scheduled_after = published_at ?? now`.
- **Jobs page** `/jobs` (sidebar): table for the current brand — type, status badge, runner, created, duration, tokens, error (truncated, full in a popover), link to the post/article, Retry (failed), Cancel (queued → failed "cancelled"). Auto-refreshes every 5s while any job is queued/running.
- **Dashboard**: tile with running / failed counts (link to Jobs).
- **Brand → Content mix tab**: table of categories (name, slug auto, target %, description, order) with add/edit/delete; validation that targets sum ≤ 100%; a bar per category showing actual vs target from `get_content_mix`.
- **Settings** (new top-level page, also home for future app-wide settings): AI model select (`claude-sonnet-5`, `claude-opus-5`), MCP connection card, key-present indicators for `ANTHROPIC_API_KEY` / `MCP_TOKEN`.

## Prompts

`src/lib/ai/prompts/` — one file per job type exporting `system(brief)` and `user(brief)`. Shared preamble: you are writing for `{brand}`; follow the guideline documents verbatim; hard rules; use tools to look things up rather than guessing; finish by calling the terminal tool exactly once. Type specifics:

- **caption**: post title/link/images (URLs + alt), content mix with `favour_next`, last 5 approved captions for tone; produce FB and IG variants; choose a category.
- **article**: brief fields; `blog_style` + `blog_post_spec`; media list and instruction to pick a featured image with `used_as_featured=false` and 1–3 body images (search WP media if the library lacks a fit); list of existing article titles/URLs for internal links; SEO constraints (H1 with keyword near the front, slug with keyword, seo_title ending in suffix, meta 120–156).
- **promo**: the article (title, excerpt, url, featured image); condense into a short post; CTA "Read more" with the link; `link_url = article.url`; `scheduled_at` ≥ `scheduled_after`.
- **rewrite**: the original post and its captions; produce a fresh angle, same facts; same media and link; `recycled_from = post_id`.

## Testing

- **Unit (vitest)**: caption validator; content-mix maths (targets, window, favour_next, uncategorized dilution); every tool's `run()` against a mocked Supabase client; `claim_job` atomicity (second claim fails); runner loop with a fake Anthropic client scripted to call a lookup tool, produce an invalid caption, get the error, then call the terminal tool — asserts the job row transitions and token accounting; backstop selection (`/api/cron/jobs` picks only stale jobs under the attempt cap).
- **MCP**: in-process test — `@modelcontextprotocol/sdk` `Client` over a `fetch` shim calling the route handler: 401 without token, `tools/list` returns every registry tool, `tools/call list_brands` works.
- **E2E (Playwright, no API key)**: create a content-mix category on the e2e brand; queue an article job with runner = MCP; see it on the Jobs page as queued; cancel it; verify teardown removes jobs (they cascade with the e2e brand).
- **Live** (Task 7 of the plan): in-app caption job on a real draft; in-app article job that lands with images and SEO fields, pushed via Phase 3; one MCP-runner job claimed and completed from Claude Code connected to the prod MCP URL.

## Dependencies

`@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `zod-to-json-schema` (or zod v4's native `z.toJSONSchema`, preferred if it covers what we use).
