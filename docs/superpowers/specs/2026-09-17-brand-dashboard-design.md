# Brand dashboard — design

Date: 2026-09-17. Branch: phase-8-internal-links (new work continues on top).

## Goal

Clicking a brand opens a dashboard that answers, in order: what needs a person right now, whether the machinery behind it is healthy, whether the published content mix matches its targets, and which pushed articles still need to be submitted to Google Search Console. Modeled on the SSA Social dashboard screenshot. The brand's configuration (details, schedule, connections, guidelines, content mix) moves under a per-brand Settings area.

## 1. Routing & navigation

- `/brands/[slug]` — the brand dashboard. Sections top to bottom: Needs you, System health, Content quality, Submit to Search Console, freshness footer. Header: brand name, `Archived` badge when inactive, a **Settings** button → `/brands/[slug]/settings`.
- `/brands/[slug]/settings` (new) — the current Overview content: slug / website / timezone / SEO suffix, Edit and Archive/Restore buttons, posting schedule form, history import.
- `/brands/[slug]/connections`, `/guidelines`, `/content-mix` keep their URLs (OAuth callbacks and several components redirect to them). `BrandNav` becomes a settings tab strip — **General · Connections · Guidelines · Content mix** — rendered on those four pages only, never on the dashboard.
- `/dashboard` redirects to `/brands/<current brand slug>`; with no brands it redirects to `/brands/new`. Sidebar keeps linking to `/dashboard`.
- Brand switcher: after `setCurrentBrand(slug)`, if the current pathname matches `/brands/<oldSlug>(/rest)?` it navigates to `/brands/<newSlug>(/rest)`; otherwise it stays on the page (current behaviour, the page re-renders for the new brand).
- The global brand-card grid and `getDashboardBrands` are deleted.

## 2. Needs you

Per brand, derived from row data by pure functions.

| Tile | Counts | Link |
|---|---|---|
| Awaiting approval | posts `pending_approval` + pins `pending_approval` + link_suggestions `pending` | `/posts?status=pending`, `/pins`, `/blog/links` |
| Needs attention | posts `failed` + pins `failed` + post_targets `failed` + generation_jobs `failed` + overdue items + connections `failing` | `/jobs`, `/posts`, `/brands/[slug]/connections` |
| Waiting on Claude | generation_jobs `queued` with runner `mcp`; subtext also mentions `claimed`/`running` count | `/jobs` |
| Big number | sum of the three tiles; subtitle "across approvals, publishing, writing and SEO" | — |
| Approved and scheduled | post_targets `pending` with future `scheduled_at` whose post is `approved` + pins `approved` with future `scheduled_at` | `/calendar` |

Overdue = post_targets `pending` (post `approved`/`publishing`) or pins `approved` whose `scheduled_at` is more than 15 minutes in the past.

Zero-state copy matches the screenshot ("Nothing publishes until you approve it", "Nothing failed or overdue", "Open Claude with the connector to write these"); non-zero subtext is specific ("2 failed · 1 overdue").

## 3. System health

One "Checks" card. Each row has a state `ok | pending | warn`, a label, and one line of detail. Header badge: **All good** when every row is `ok`, else **Needs a look**.

Rows, in order:
1. **Publisher** — `warn` "N items overdue" when overdue > 0; else `ok` "last published <relative time>" from the latest post_target/pin `published_at`, or `ok` "nothing scheduled yet".
2. **One row per provider** in `PROVIDER_ORDER` (+ `gbp` when `GBP_ENABLED`):
   - `connected` → `ok` "Connected — checked <relative last_checked>". Meta / Meta Ads append " — data access good through <expires_at date>" when `config.expires_at` exists; `warn` when it expires within 7 days or has passed.
   - `failing` → `warn` "Failing — <last_error>".
   - missing / `not_connected` → `pending` with a consequence: wordpress "Not connected — blog can't publish"; meta "Not connected — drafts only"; meta_ads "Not connected — no ad metrics"; google_analytics "Not connected — no traffic data"; search_console "Not connected — no search data"; pinterest "Not connected — pins stay drafts"; semrush "Not connected — keyword data from CSV/GSC only"; gbp "Not connected — no Google posts".
3. **Metrics sync** — one row per `sync_runs` source for the brand: `ok` "last ok <relative>" or `warn` "<last_error>". Skipped when the brand has no sync runs.

Footer under the dashboard: `dataFreshness(imports)` note with a link "Upload a new export" → `/seo?tab=imports`, green dot when not stale, amber when stale.

## 4. Content quality

Quantifies **mix adherence**: for each configured post category, the share of the last N approved/published social posts in that category (from `computeContentMix`, counted from what actually went out) versus its target share. It does not measure writing quality or engagement; the subtitle says so.

- One bar per category: fill = actual %, tick at target %, label "X% of the last N".
- Footer: "Next post: **<category furthest under target>**" — the same pick the generator makes.
- Empty state: "No categories yet — set targets in Settings → Content mix" linking to `/brands/[slug]/content-mix`.

## 5. Submit to Search Console

- Queue = brand articles with a non-null `wp_link`, status `pushed_to_wp` or `published`, `gsc_submitted_at IS NULL`; ordered by `pushed_at` desc (nulls last). Heading shows the count.
- Header link **open Search Console →** = `https://search.google.com/search-console?resource_id=<encodeURIComponent(website_url)>`; omitted when the brand has no website URL.
- How-to line: "Copy a URL, paste it into the URL inspection bar in Search Console, click Request indexing, then mark it Done here."
- Row: URL text, **copy** (clipboard + toast "Copied"), **done** → server action `markSubmittedToSearchConsole(articleId)` sets `gsc_submitted_at = now()`; row disappears.
- Article page (`/blog/[id]`) shows "Submitted to Search Console <date>" with a "Not submitted" link calling `unmarkSubmittedToSearchConsole(articleId)` (sets null). No undo on the dashboard.
- Empty state: "Nothing waiting — every pushed article has been submitted."

Migration `supabase/migrations/0013_gsc_submitted.sql`: `alter table articles add column gsc_submitted_at timestamptz;`. Regenerate `src/lib/database.types.ts` (or add the column by hand matching the generated shape).

## 6. Code layout

- `src/lib/dashboard/brand-summary.ts` — pure: `summariseNeedsYou(input, now)`, `deriveHealthChecks(input, now)`, `gscQueue(articles)`, `nextCategory(mix)`. Input types are plain row shapes so tests need no Supabase.
- `src/lib/dashboard/queries.ts` — `getBrandDashboard(brand)` runs all reads in one `Promise.all` (posts, pins, post_targets, generation_jobs, link_suggestions counts, brand_connections incl. config expiry, sync_runs, articles for queue, categories + recent categorized posts, keyword_imports) and returns the derived view model.
- `src/lib/articles/actions.ts` — `markSubmittedToSearchConsole`, `unmarkSubmittedToSearchConsole` (revalidate `/brands/[slug]` and `/blog/[id]`).
- `src/components/dashboard/needs-you.tsx`, `health-checks.tsx`, `content-quality.tsx`, `gsc-queue.tsx` (client: copy + done with `useTransition`).
- Pages: `src/app/(app)/brands/[slug]/page.tsx` (dashboard), `src/app/(app)/brands/[slug]/settings/page.tsx`, `brand-nav.tsx` (settings tabs), `src/app/(app)/dashboard/page.tsx` (redirect), `src/components/shell/brand-switcher.tsx`.

## 7. Error handling

- Query errors throw (existing pattern) → Next error boundary.
- `done` action failure → toast with the error; row stays.
- Clipboard unavailable (non-secure context) → toast "Couldn't copy — select the URL instead".

## 8. Testing

Vitest on `brand-summary.ts`:
- overdue threshold (14 min not overdue, 16 min overdue), failed items and failing connections count toward attention, mcp queued jobs → waiting on Claude, big number = sum, scheduled excludes past.
- health: publisher warn when overdue; Meta expiry in 6 days → warn, 8 days → ok with date; missing provider → pending with consequence copy; badge "Needs a look" iff any non-ok.
- gscQueue: excludes drafts, no wp_link, already submitted; ordering.
- nextCategory picks the largest target − actual gap.

Existing content-mix tests cover the bars' numbers. Manual browser check of the dashboard against the screenshot after implementation.
