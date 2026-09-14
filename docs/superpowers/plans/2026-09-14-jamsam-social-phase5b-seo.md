# JamSam Social Phase 5b: SEO Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keyword opportunities (GSC + CSV + SEMrush), cannibalization checks against articles + a live-site mirror, a project content bank, AI clustering, exposed on an SEO page, in the editor, and as MCP tools with runner enforcement.

**Architecture:** Pure computation in `src/lib/seo/` (csv, score, cannibalization, links, freshness, extract) with tests; integrations (`mirror`, `crawl`, `semrush`, `gsc-enrich`) take `fetchImpl`/store deps; a `SeoStore` interface (added to the AI `Store`) backs tools and pages. Nightly work hangs off the existing metrics cron.

**Tech Stack:** Next.js 16, Supabase (tsvector search), fetch, zod, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-jamsam-social-phase5b-seo-design.md`

## Global Constraints

- Keywords are stored lower-cased and whitespace-collapsed; compare with `normaliseKeyword`.
- Never call SEMrush without an explicit user action; show the unit estimate first.
- Sitemap crawl caps at 500 URLs, concurrency 4, 10s per page, and only same-host URLs under the prefix.
- `create_article` must reject a NEW article that conflicts; OPTIMIZE/REWRITE with the existing slug is allowed.
- Commit per task with the standard trailers; typecheck/lint/test green before each commit.

---

### Task 1: Migration + types + store surface
- Migration `0009_seo.sql` per spec (enum, 4 tables, job_type value, RLS). Types in `database.types.ts`. `Store` gains: `listSitePages(brandId, q?)`, `listKeywords(brandId, opts)`, `upsertKeywords(brandId, rows)`, `setClusters(brandId, assignments)`, `searchProjects(brandId, opts)`, `listGscQueryPages(brandId, days)` (from `metrics_daily` new source `gsc_query_page`), `logImport(...)`, `listImports(brandId)`; fake store updated. Metrics migration: `metric_source` add `gsc_query_page`; sync captures top-3 pages per query per day.

### Task 2: Pure SEO library (TDD)
- `csv.ts`: `parseKeywordCsv(text): { rows: KeywordInput[]; skipped: number; columns: string[] }` with alias matching + SEMrush Keyword Gap layout; `parseProjectsCsv`.
- `score.ts`: `normaliseKeyword`, `opportunityAction(k)`, `opportunityScore(k)`, `rankOpportunities(keywords, filters)`.
- `cannibalization.ts`: `checkCannibalization(input)` → `{ has_conflict, verdict, conflicts, live_page_using_this_slug, already_listed_as_opportunity }`.
- `links.ts`: `suggestInternalLinks(keyword, title, sitePages)`.
- `freshness.ts`: `dataFreshness(imports, now)`.
- `extract.ts`: `extractProjectFromHtml(html, url)`; `filterSitemapUrls(xml, prefix, host)`.
- `gsc-enrich.ts`: `enrichFromGsc(keywords, gscQueryRows, gscQueryPageRows)` → upsert patches.

### Task 3: Integrations
- `mirror.ts` (WP REST paging, upsert/delete), `crawl.ts` (sitemap + pages, chunked with `after()`), `semrush/client.ts` (`phraseThese`, `domainDomains`, unit estimate), `gsc-enrich` runner; hook mirror + GSC enrich into `runMetricsCycle`; server actions `importKeywordsCsv`, `importProjectsCsv`, `startCrawl`, `refreshSemrush`, `refreshGsc`, `mirrorSite`, `setKeywordCluster`; SEMrush config gains `competitors` (comma list field).

### Task 4: Tools + runner enforcement + clustering job
- Tools: `list_keyword_opportunities`, `check_cannibalization`, `search_site_pages`, `search_projects`, `assign_clusters`. `create_article` runs the check. Job type `seo_cluster` with instructions + terminal `assign_clusters`; brief carries un-clustered keywords and cluster names; article brief carries matching `opportunity`.

### Task 5: /seo page + editor hints
- Tabs Opportunities / Keyword map / Content bank / Imports; "Write this" prefill via `/articles?brief=`; NewFromBrief reads search params; article form gets `CannibalizationHint` + `InternalLinks`.

### Task 6: E2E, live, deploy, merge
- E2E: CSV import → table → Write this prefill. Live: mirror jamsamdigital.com; cluster job. Deploy, PR, merge.
