# JamSam Social Phase 5a: Connections & Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-brand GA4, Search Console, and Meta Ads connections synced nightly into `metrics_daily`, and a Reports page (Overview / Search / Content & social) with SSA-style tiles, tables and charts; GBP posting behind a flag.

**Architecture:** Thin API clients (`src/lib/google/*`, `src/lib/meta/ads.ts`) take a `fetchImpl` and return raw API JSON. Pure mappers turn raw responses into `MetricRow`s; a pure aggregator turns rows into report view-models. `syncBrand` glues clients → mappers → upsert and records `sync_runs`. The Reports page reads only `metrics_daily` and Phase 2 tables.

**Tech Stack:** Next.js 16, Supabase, `google-auth-library` (service-account JWT), fetch, inline SVG charts, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-jamsam-social-phase5a-connections-reports-design.md`

## Global Constraints

- Server Components never receive event handlers; interactive bits are `"use client"`.
- Secrets only via `src/lib/env.ts`; `GOOGLE_SERVICE_ACCOUNT_JSON` and `GBP_ENABLED` are optional.
- Money is stored as numbers in the platform's currency (USD assumed for display); never sum Meta and Google leads; cost/lead renders "—" when leads = 0.
- Dates in `metrics_daily.date` are the platform's reporting date (GA4 property timezone / GSC PT / Meta ad-account timezone) stored as `YYYY-MM-DD`.
- Commit per task with the standard trailers; `npm run typecheck && npm run lint && npm test` green before each commit.

---

### Task 1: Migration, enums, types, env, deps

**Files:** `supabase/migrations/0006_metrics.sql`, `src/lib/database.types.ts`, `src/lib/env.ts` (+ test), `src/lib/connections/types.ts`, `vitest.config.ts`, `package.json`.

- [ ] Migration: `alter type connection_provider add value 'google_analytics'`, `'search_console'`, `'meta_ads'`, `'gbp'`; `metric_source` enum; `metrics_daily` and `sync_runs` tables as in the spec; RLS: enable both, policy `authenticated read` (`for select to authenticated using (true)`) only.
- [ ] Types: `ConnectionRow.provider` union grows; add `MetricsDailyRow { brand_id; source; date; dim; metrics: Json; extra: Json | null; synced_at }`, `SyncRunRow`; `Tables.metrics_daily: Table<…, "brand_id"|"source"|"date"|"dim"|"metrics">`, `Tables.sync_runs: Table<…, "brand_id"|"source">`; enum `metric_source`.
- [ ] `types.ts`: `Provider` union + `PROVIDER_LABELS` (`google_analytics: "Google Analytics 4"`, `search_console: "Google Search Console"`, `meta_ads: "Meta Ads"`, `gbp: "Google Business Profile"`).
- [ ] Env: `GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional()`, `GBP_ENABLED: z.enum(["true","false"]).default("false")`, `GOOGLE_OAUTH_CLIENT_ID/SECRET: optional`. Test: parses without them.
- [ ] `npm i google-auth-library`; push migration; commit `feat(db): metrics_daily, sync_runs, new providers`.

### Task 2: Google service-account auth + GA4/GSC clients (fixture-tested)

**Files:** `src/lib/google/auth.ts`, `src/lib/google/ga4.ts`, `src/lib/google/gsc.ts`, tests.

**Interfaces:**
```ts
// auth.ts
export function serviceAccount(): { email: string; key: string } | null;   // from env JSON; null if unset/invalid
export async function googleAccessToken(scopes: string[]): Promise<string>; // JWT via google-auth-library, cached until expiry
// ga4.ts
export type Ga4Row = { dims: string[]; metrics: number[] };
export async function ga4RunReport(propertyId: string, body: { dateRanges; dimensions; metrics; limit?; orderBys? }, deps: { token: string; fetchImpl?: typeof fetch }): Promise<{ rows: Ga4Row[]; dimensionHeaders: string[]; metricHeaders: string[] }>;
export async function ga4ListKeyEvents(propertyId: string, deps): Promise<{ eventName: string }[]>;   // admin API v1beta properties/{id}/keyEvents
export class GoogleApiError extends Error { status: number; reason?: string }
// gsc.ts
export async function gscQuery(siteUrl: string, body: { startDate; endDate; dimensions: string[]; rowLimit?: number; startRow?: number }, deps): Promise<{ rows: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }>;
```
- [ ] Tests with recorded-shape fixtures: GA4 rows parse to numbers; 403 → `GoogleApiError` with reason text; GSC rows parse; `serviceAccount()` null when env missing, parses email when set (use a fake JSON in the test env).
- [ ] Commit `feat(google): service-account auth, GA4 + Search Console clients`.

### Task 3: Meta Ads client + the three connection providers + cards

**Files:** `src/lib/meta/ads.ts` (+test), `src/lib/connections/google-analytics.ts`, `search-console.ts`, `meta-ads.ts`, `index.ts`, `src/components/brands/connection-forms.tsx`, `connection-card.tsx`, `src/lib/connections/actions.ts` (new actions `listGa4KeyEvents(brandId)`, `findAdAccounts(token)`), `src/components/brands/ga4-lead-events.tsx`, `src/components/brands/meta-ad-accounts.tsx`.

**Interfaces:**
```ts
// meta/ads.ts
export async function metaAdAccounts(token, fetchImpl?): Promise<{ id: string; name: string; currency: string }[]>;   // /me/adaccounts
export async function metaAdInsights(adAccountId, token, { since, until, level: "campaign" | "account" }, fetchImpl?): Promise<MetaInsightRow[]>; // time_increment=1, paginates
export type MetaInsightRow = { date_start: string; campaign_id?: string; campaign_name?: string; spend: string; clicks: string; impressions: string; inline_link_clicks?: string; actions?: { action_type: string; value: string }[] };
```
- [ ] Providers per spec table; `google_analytics.test` also writes back `property_name`, `ads_linked` via the returned detail (extend `TestResult` with optional `configPatch?: Record<string, unknown>` and have `saveAndTestConnection` merge it).
- [ ] Cards: GA4 shows SA email + steps, key-events picker (checkboxes loaded via action after save); GSC shows SA email + steps; Meta Ads shows token field + "Find ad accounts" → select; `PROVIDER_ORDER` = wordpress, meta, meta_ads, google_analytics, search_console, pinterest, semrush (+ gbp when flagged).
- [ ] Dashboard connection health includes the new providers (already generic via `PROVIDER_ORDER`).
- [ ] Commit `feat(connections): GA4, Search Console, Meta Ads providers`.

### Task 4: Metrics pure layer — ranges, mappers, aggregate (TDD)

**Files:** `src/lib/metrics/ranges.ts`, `mappers.ts`, `aggregate.ts`, `channels.ts`, tests.

```ts
// ranges.ts
export type RangeKey = "30d" | "90d" | "12m" | "all";
export type Window = { start: string; end: string };  // YYYY-MM-DD inclusive
export function currentWindow(key: RangeKey, today: string, earliest?: string): Window;   // end = today-1 (yesterday)
export function previousWindow(w: Window): Window;   // same length, immediately before
export function lastYearWindow(w: Window): Window;
export function bucketOf(date: string, mode: "week" | "month"): string;   // week = Monday ISO date; month = YYYY-MM
export function bucketMode(key: RangeKey): "week" | "month";  // 30d/90d → week, 12m/all → month
export function syncWindow(opts: { backfill: boolean; today: string; lagDays: number; lookbackDays: number }): Window;
// mappers.ts  → MetricRow = { source; date; dim; metrics: Record<string, number>; extra?: Record<string, string> }
export function mapGa4Channels(rows: Ga4Row[], leadEventCount: number): MetricRow[];   // dims [date, channel]; metrics [sessions, engagedSessions, keyEvents:a, keyEvents:b…] → leads = sum
export function mapGa4Totals(rows): MetricRow[];          // dims [date]; metrics [sessions, leads…, googleAdsCost, googleAdsClicks, conversions]
export function mapGa4Campaigns(rows): MetricRow[];       // dims [date, campaign]; metrics [cost, clicks, conversions, sessions]; drops "(not set)" and zero-cost rows
export function mapGsc(rows, source: "gsc_total"|"gsc_query"|"gsc_page"): MetricRow[];
export function mapMetaCampaigns(rows: MetaInsightRow[]): MetricRow[];   // leads from action_type set
export function mapMetaTotals(rows): MetricRow[];
// channels.ts
export const PAID_CHANNELS = new Set(["Paid Search","Paid Social","Paid Video","Paid Shopping","Paid Other","Display","Cross-network"]);
export function isPaid(channel: string): boolean;
// aggregate.ts
export function sumMetric(rows: MetricRow[], key: string): number;
export function costPerLead(cost: number, leads: number): number | null;
export function pctChange(cur: number, prev: number): number | null;   // null when prev = 0
export function median(nums: number[]): number | null;
export function byDim(rows, key): { dim: string; extra?; total: number }[];   // sorted desc
export function byBucket(rows, mode, key): { bucket: string; total: number }[];
export function buildOverview(input: { cur: MetricRow[]; prev: MetricRow[]; ly: MetricRow[]; mode }): OverviewVM;   // tiles, spendByMonth, byPlatform, metaCampaigns, adsCampaigns, channels, paidVsEarned
export function buildSearch(input): SearchVM;
```
- [ ] Tests: window maths incl. month boundaries and leap year; bucket Monday alignment; each mapper on a fixture; `costPerLead(100, 0) === null`; `pctChange(5, 0) === null`; median even/odd; `buildOverview` on a small synthetic dataset asserting tile numbers and that Meta and Google leads are never summed.
- [ ] Commit `feat(metrics): ranges, mappers, aggregation`.

### Task 5: Sync + cron + Sync now

**Files:** `src/lib/metrics/sync.ts` (+test with injected clients), `src/lib/metrics/queries.ts` (server: `loadRows(brandId, sources, window)`, `loadSyncRuns(brandId)`), `src/lib/metrics/actions.ts` (`syncNow(brandId)` with 5-min cooldown), `src/app/api/cron/metrics/route.ts`, migration addendum in `0006` for the cron schedule (`0 11 * * *` → `/api/cron/metrics`).

```ts
export type SyncDeps = { store: MetricsStore; ga4?: Ga4Client; gsc?: GscClient; metaAds?: MetaAdsClient; today: string };
export async function syncBrand(brandId: string, connections: BrandMetricConnections, deps: SyncDeps, opts: { backfill?: boolean }): Promise<Record<"ga4"|"gsc"|"meta_ads", { ok: boolean; rows: number; error?: string }>>;
```
- [ ] Windows: incremental lookback 3 days (GSC lag 3 → ends today−3); backfill 395 days paged by 31; sets `sync_runs.backfilled` after a full backfill.
- [ ] Tests with fake clients: rows upserted per source; a throwing source records `last_error` without aborting others; backfill pages; GSC window lag.
- [ ] Commit `feat(metrics): nightly sync, cron route, sync now`.

### Task 6: Reports page

**Files:** `src/app/(app)/reports/page.tsx`, `src/components/reports/{controls,tiles,banner,overview,search,content-social}.tsx`, `src/components/reports/charts/{grouped-bars,horizontal-bars,line-chart,show-numbers}.tsx`, `src/lib/reports/queries.ts` (content & social from posts/articles), sidebar entry.

- [ ] Controls read `?tab=&range=`; brand from header switcher; `synced at` + error banner from `sync_runs`.
- [ ] Overview/Search/Content per spec; charts are SVG server components; `ShowNumbers` is a small client toggle.
- [ ] Empty states per tab pointing to Connections.
- [ ] E2E: `/reports` renders empty state; seed 3 days of `ga4_total`/`gsc_total`/`meta_ads_total` for an e2e brand via service role and assert tile text.
- [ ] Commit `feat(reports): reports page with overview, search, content tabs`.

### Task 7: GBP behind a flag

**Files:** `src/lib/connections/gbp.ts`, `src/app/api/auth/google/{start,callback}/route.ts`, `src/lib/google/gbp.ts` (accounts/locations/localPosts), `src/components/brands/gbp-locations.tsx`, publisher `src/lib/publishers/gbp.ts`, `post_targets.platform` enum add `gbp`, migration `0007_gbp.sql`.

- [ ] Only rendered/registered when `env.GBP_ENABLED === "true"`; `approvePost` creates `gbp` targets for enabled locations; publisher posts `localPosts.create` (summary = FB caption, media = first image URL, callToAction ACTION_TYPE LEARN_MORE with link_url).
- [ ] Unit: payload builder; provider test with fixture; publisher with fake fetch.
- [ ] Settings page: GBP card explaining how to request API access.
- [ ] Commit `feat(gbp): Google Business Profile posting (flagged)`.

### Task 8: Live verification, deploy, merge

- [ ] Set `GOOGLE_SERVICE_ACCOUNT_JSON` locally + Vercel (user creates the SA in Google Cloud: IAM → Service Accounts → create → JSON key; enable "Google Analytics Data API", "Google Analytics Admin API", "Google Search Console API").
- [ ] Connect JamSam Digital GA4 + GSC; pick lead events; Sync now (backfill); Reports shows real data; connect Meta Ads if an ad account exists.
- [ ] `typecheck && lint && test && e2e`; deploy; PR; merge.
