# JamSam Social — Phase 5b: SEO intelligence

**Date:** 2026-09-14
**Status:** Approved in conversation; written for execution
**Builds on:** Phase 3 (articles, WP client), Phase 4 (jobs, MCP tools), Phase 5a (Search Console data in `metrics_daily`)

## Purpose

Tell each brand what to write next and stop it competing with itself: ranked keyword opportunities (from Search Console, CSV imports and SEMrush), a cannibalization check that knows the live site, a content bank of source material, and AI-assisted topic clustering. Surfaced on an SEO page, in the article editor, and as MCP tools the writers must use.

## Decisions carried from brainstorming

- Keyword sources: **Search Console striking distance** (free, already synced), **CSV import** (SEMrush exports or any keyword CSV), **SEMrush API** (per-brand key, explicit refresh with unit estimate).
- Content bank: **site mirror** (WordPress posts + pages) **plus a project bank** filled by CSV import or a sitemap crawl.
- Clusters: **imported when present, AI-suggested otherwise, editable**.
- Surfaces: MCP tools + in-app article runner enforcement; **/seo** page; article editor hints.

## Out of scope

Rank tracking history charts (GSC position trend per query is on Reports → Search), backlink data, competitor content scraping beyond titles, SERP feature analysis, automatic article briefs (the "Write this" button prefills the existing brief dialog).

## Data model

```sql
create type keyword_source as enum ('csv','semrush','gsc','manual');

create table site_pages (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  wp_id        int not null,
  type         text not null,                -- 'post' | 'page'
  slug         text not null,
  url          text not null,
  title        text not null,
  excerpt      text,
  focus_keyword text,                        -- Yoast, via the helper plugin's REST meta
  featured_image_url text,
  modified_at  timestamptz,
  mirrored_at  timestamptz not null default now(),
  unique (brand_id, type, wp_id)
);
create index site_pages_brand_slug on site_pages (brand_id, slug);

create table keywords (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  keyword       text not null,               -- lower-cased, trimmed
  cluster       text,
  volume        int,
  difficulty    int,                         -- 0–100
  intent        text,                        -- 'Informational' | 'Commercial' | 'Transactional' | 'Navigational' or comma list
  competitor    text,                        -- best competitor domain
  competitor_position int,
  our_position  numeric(5,1),                -- from GSC (28-day avg), null if never seen
  our_impressions int,
  our_clicks    int,
  our_page      text,                        -- GSC top page url for the query
  source        keyword_source not null default 'csv',
  notes         text,
  imported_at   timestamptz not null default now(),
  refreshed_at  timestamptz,
  unique (brand_id, keyword)
);

create table projects (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  external_id  text,                         -- job number / CSV id / url
  title        text not null,
  url          text,
  category     text,
  location     text,
  state        text,                         -- 2-letter when known
  dims         text,                         -- '40x60'
  description  text,
  images       jsonb not null default '[]',  -- [{url, alt}]
  tags         text[] not null default '{}',
  search       tsvector generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(location,'') || ' ' || coalesce(category,'') || ' ' || coalesce(dims,''))) stored,
  imported_at  timestamptz not null default now(),
  unique (brand_id, url)
);
create index projects_search on projects using gin (search);

create table keyword_imports (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references brands(id) on delete cascade,
  kind       text not null,                  -- 'keywords_csv' | 'projects_csv' | 'sitemap_crawl' | 'semrush_refresh' | 'gsc_refresh' | 'site_mirror'
  detail     text,                           -- filename / url / competitor list
  rows       int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter type job_type add value if not exists 'seo_cluster';
alter table brand_connections ... -- semrush config gains competitors: string[] (config JSON, no migration)
```

RLS: authenticated read/write on all four (team-only app), service role for sync.

## Computation (pure, `src/lib/seo/`)

- **Normalise**: `keyword` lower-cased, whitespace collapsed; CSV columns matched case-insensitively with aliases (`Keyword`, `Search Volume|Volume`, `Keyword Difficulty|KD|Difficulty`, `Intent`, `Competitor|Domain`, `Position|Competitor Position`, `Cluster|Topic|Group`, and SEMrush Keyword Gap's per-domain position columns — the first non-brand domain column with the best position becomes the competitor).
- **GSC enrichment** (nightly + on demand): for each brand with GSC rows, aggregate the last 28 days of `gsc_query` (weighted position, impressions, clicks) and `gsc_page` and upsert onto `keywords` (`source='gsc'` for queries not already present with ≥ 20 impressions; existing rows only get `our_*` updated). `our_page` = top page for the query from a query+page report captured during the metrics sync (new source `gsc_query_page`, dims `query|page`, top 3 pages per query per day).
- **Opportunity**: `action = ourPage ? "OPTIMIZE (ranks #n)" : "NEW"`; `score` = clamp(0–10) of `2.2·log10(volume+10) + (100−difficulty)/25 + intent(Transactional 2, Commercial 1.5, Informational 1, else 0.5) + (ourPosition between 5 and 20 ? 2 : 0) + (competitorPosition ≤ 10 ? 0.5 : 0)`; sort by score desc, volume desc. Missing volume/difficulty use 0 / 50.
- **Cannibalization** (`checkCannibalization({ keyword, slug?, articles, sitePages, gscPages })`): conflicts when (a) an article's primary keyword equals it, (b) an article or site page has the slug (`live_page_using_this_slug`), (c) a site page's focus keyword equals it or its title contains all keyword tokens, (d) GSC shows a page ranking for it. `has_conflict` = any of a–d; `already_listed_as_opportunity` is informational. Verdict copy mirrors SSA's.
- **Internal link suggestions**: site pages whose title/focus keyword shares ≥ 2 tokens with the keyword or title, top 5.
- **Freshness**: `stale` when the newest `keywords_csv`/`semrush_refresh` import is > 30 days old (GSC-only brands are never stale).

## Integrations

- **Site mirror** (`src/lib/seo/mirror.ts`): WP REST `/wp/v2/posts` and `/wp/v2/pages` with `status=publish`, `_fields=id,slug,link,title,excerpt,modified,featured_media,meta` (`meta._yoast_wpseo_focuskw` present when the helper is installed), paged 100; upsert `site_pages`; delete rows no longer returned. Runs nightly in the metrics cron for brands with WordPress connected, and on "Mirror now".
- **Sitemap crawl** (`src/lib/seo/crawl.ts`): fetch `sitemap.xml` (follow index sitemaps), keep URLs starting with the given prefix (max 500), fetch each page with concurrency 4, extract `<title>`/`og:title`, `meta description`/`og:description`, `og:image` + first 8 `<img>` in `<main>`/`<article>`, JSON-LD `Product`/`Article` when present, and heuristics for dims (`\b\d{2,3}\s?[x×]\s?\d{2,3}\b`) and US state (`, WA` etc.). Upsert `projects` by url. Runs as a background job (`after()`, chunked) with progress in `keyword_imports.rows`.
- **SEMrush** (`src/lib/semrush/client.ts`): `phrase_these` (batch keyword overview: volume, KD, intent) and `domain_domains` (keyword gap for brand domain vs up to 5 competitors, `database` from config). Unit estimate shown before running: overview ≈ 10 units × keywords, gap ≈ 10 units × 500 rows. Results upsert `keywords` (`source='semrush'`) and log an import.
- **Clustering job** (`seo_cluster`): brief = un-clustered keywords (≤ 300) + existing cluster names + brand context; terminal tool `assign_clusters(brand, assignments[{keyword, cluster}])` writes `keywords.cluster`; result `{ assigned: n }`. Runs in-app or MCP like other jobs.

## Surfaces

- **/seo** (sidebar "SEO"): tabs **Opportunities** (table: keyword, cluster, volume, KD, intent, competitor, our position, action, score; filters: cluster, action, search, min volume, max KD; row menu: "Write this" → `/articles?brief=<keyword>&cluster=&decision=` opens New-from-brief prefilled; inline cluster edit; "Cluster with AI" button queues `seo_cluster`), **Keyword map** (every keyword targeted by an article or site page, with the target and its GSC position; and articles with no keyword), **Content bank** (search box, category/state filters, cards with first image, detail drawer with all images, "Copy facts for a post"), **Imports** (keywords CSV, projects CSV, sitemap crawl form, "Refresh GSC", "Mirror site", "Refresh from SEMrush" with estimate; import log with freshness).
- **Article editor**: under primary keyword, a debounced server action runs `checkCannibalization` and shows the verdict; a "Suggested internal links" list from the mirror (click inserts `<a>` into the editor).
- **MCP tools**: `list_keyword_opportunities(brand, cluster?, action?, limit)`, `check_cannibalization(brand, keyword, slug?)`, `search_site_pages(brand, q)`, `search_projects(brand, q?, category?, state?, limit)`, `assign_clusters(brand, assignments)`.
- **Runner enforcement**: article instructions say "call check_cannibalization on your primary keyword and slug first"; `create_article` runs the check server-side and rejects `decision='new'` with `has_conflict` (error names the conflict and says to use decision `optimize`/`rewrite` with the existing slug or pick a new keyword). The brief for article jobs includes `opportunity` when the topic matches a keyword row.

## Testing

Unit: CSV parsing incl. SEMrush Keyword Gap layout; normalisation; score/action; cannibalization cases (a–d, slug-only, no conflict); freshness; sitemap URL filtering + page extraction on fixture HTML; SEMrush response parsing; GSC enrichment aggregation. Tool tests with the fake store. E2E: import a 3-row keywords CSV on an e2e brand → opportunities table shows rows → "Write this" opens the brief prefilled. Live: mirror jamsamdigital.com, import a real SEMrush export if available, cluster with AI.
