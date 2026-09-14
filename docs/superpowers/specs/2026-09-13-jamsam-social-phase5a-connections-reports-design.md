# JamSam Social — Phase 5a: Connections & Reports

**Date:** 2026-09-13
**Status:** Approved in conversation; written for execution
**Builds on:** Phase 1 (brand connections framework), Phase 2 (posts + insights + cron), Phase 4 (settings, jobs)

## Purpose

Give each client brand the marketing-data connections SSA Social had — Google Analytics 4, Google Ads (through the GA4 link), Meta Ads — plus Google Search Console (new), and a **Reports** page that answers "what did the spend buy and how did the published work perform" per brand and date range. Google Business Profile posting is built last behind a flag, pending Google API approval.

## Decisions carried from brainstorming

- Google auth: **one service account** owned by JamSam (`GOOGLE_SERVICE_ACCOUNT_JSON` env). Clients grant it Viewer on GA4 and user access in Search Console. No OAuth for GA4/GSC.
- Google Ads: **no Ads API**. Campaign spend/clicks/conversions come from GA4 (`googleAdsCost`, `googleAdsClicks`, `conversions` by `sessionCampaignName` / `sessionGoogleAdsCampaignName`) when the client's Ads account is linked to the GA4 property.
- Meta Ads: per-brand **ad account** + a Marketing API token with `ads_read` (separate from the publishing Page token).
- Leads: **GA4 key events chosen per brand**. Website leads = sum of those events. Platform leads (Meta `lead` actions, Google Ads conversions via GA4) are shown next to their spend and never summed with website leads.
- Data: **nightly sync into `metrics_daily`**, incremental with a 3-day re-fetch window, 13-month backfill on first connect. Reports read only our tables.
- GBP: OAuth connect + location picker + "also post to Google" on approval; **hidden unless `GBP_ENABLED=true`**.
- Charts: inline SVG components (no chart library), each with a "Show the numbers" table toggle.

## Out of scope

Google Ads API (developer token), GA4 real-time, Pinterest analytics (Phase 6), SEMrush (Phase 5b), client-facing report sharing/PDF export, custom dashboards, attribution modelling beyond what each platform reports.

## Connections

Provider enum grows: `google_analytics`, `search_console`, `meta_ads`, `gbp`. Each is a `ConnectionProvider` in `src/lib/connections/` with `test()` making a real call.

| Provider | config | secret | test() |
|---|---|---|---|
| `google_analytics` | `{ property_id: string; lead_events: string[]; ads_linked?: boolean; property_name?: string }` | `{}` (uses the env service account) | `runReport` for yesterday's `sessions`; lists key events (`keyEvents` admin API) to populate the lead-events picker; detects Ads link by requesting `googleAdsCost` for the last 30 days (non-zero or non-error → `ads_linked`). |
| `search_console` | `{ site_url: string }` (`sc-domain:client.com` or `https://client.com/`) | `{}` | `searchanalytics.query` for 1 day; on 403 explain "add `<sa email>` as a user in Search Console". |
| `meta_ads` | `{ ad_account_id: string; ad_account_name?: string }` | `{ access_token: string }` | `GET /act_{id}?fields=name,currency` + 1 day of `insights?fields=spend`. Card offers "Find ad accounts" (`/me/adaccounts`) once a token is pasted. |
| `gbp` (flagged) | `{ locations: { name: string; title: string; enabled: boolean }[] }` | `{ refresh_token: string }` | `accounts.list` + `locations.list`. |

Service account email is shown on the GA4 and GSC cards (parsed from the env JSON) with copy buttons and the exact grant steps.

Env: `GOOGLE_SERVICE_ACCOUNT_JSON` (optional; GA4/GSC cards show "not configured" without it), `GBP_ENABLED` (default false), `GOOGLE_OAUTH_CLIENT_ID/SECRET` (only when GBP enabled).

## Data model

```sql
create type metric_source as enum (
  'ga4_channel',       -- dimension: sessionDefaultChannelGroup;  metrics: sessions, engaged_sessions, leads
  'ga4_campaign',      -- dimension: sessionCampaignName (Google Ads only); metrics: cost, clicks, conversions, sessions
  'ga4_total',         -- dimension: '_';  metrics: sessions, leads, google_ads_cost, google_ads_clicks, google_ads_conversions
  'gsc_total',         -- dimension: '_';  metrics: clicks, impressions, ctr, position
  'gsc_query',         -- dimension: query; metrics: clicks, impressions, ctr, position
  'gsc_page',          -- dimension: page;  metrics: clicks, impressions, ctr, position
  'meta_ads_campaign', -- dimension: campaign_id; metrics: spend, clicks, impressions, leads, link_clicks; extra: campaign_name
  'meta_ads_total'     -- dimension: '_';  metrics: spend, clicks, impressions, leads
);

create table metrics_daily (
  brand_id   uuid not null references brands(id) on delete cascade,
  source     metric_source not null,
  date       date not null,
  dim        text not null,            -- dimension value or '_' for totals
  metrics    jsonb not null,           -- { sessions: 123, ... } numbers only
  extra      jsonb,                    -- labels, e.g. { campaign_name }
  synced_at  timestamptz not null default now(),
  primary key (brand_id, source, date, dim)
);
create index metrics_daily_brand_source_date on metrics_daily (brand_id, source, date desc);

create table sync_runs (
  brand_id     uuid not null references brands(id) on delete cascade,
  source       text not null,          -- 'ga4' | 'gsc' | 'meta_ads'
  last_run_at  timestamptz,
  last_ok_at   timestamptz,
  last_error   text,
  backfilled   boolean not null default false,
  primary key (brand_id, source)
);
```

RLS: authenticated read on both; writes via service role only (no insert/update policies for `authenticated`).

Retention: rows are kept indefinitely (small: per brand per day ≈ 10 channels + ~50 queries + ~50 pages + campaigns). GSC query/page rows keep the top 100 per day by clicks.

## Sync

`src/lib/metrics/sync.ts` — `syncBrand(brandId, opts: { backfill?: boolean })` runs each connected source independently, recording `sync_runs` per source:

- **GA4** (Data API v1beta `runReport`, service-account JWT via `google-auth-library`): date ranges by day; dimensions/metrics per source above; `leads` = sum of `keyEvents:<name>` for the brand's `lead_events`. Ads campaign rows only when `ads_linked`.
- **GSC** (Search Console API `searchanalytics.query`): `dimensions: ["date"]` for totals; `["date","query"]` and `["date","page"]` with `rowLimit` 100 per day (sorted by clicks). Window ends at `today − 3` (GSC finalises with ~2-day lag).
- **Meta Ads** (Graph `act_{id}/insights` with `time_increment=1`, `level=campaign`, fields `spend,clicks,impressions,inline_link_clicks,actions`, date preset via `time_range`): `leads` = sum of `actions` where `action_type` ∈ {`lead`, `onsite_conversion.lead_grouped`, `offsite_conversion.fb_pixel_lead`}.
- Windows: incremental = last 3 days (Meta and GA4 restate); backfill = 13 months, paged 31 days at a time.
- Upserts on the primary key. Errors are caught per source and stored in `sync_runs.last_error`; the other sources continue.

Trigger: `/api/cron/metrics` on the existing pg_cron, daily 11:00 UTC (≈ 04:00 Pacific); it syncs every active brand with at least one metrics connection. "Sync now" button per brand on the Connections tab (and the Reports banner) calls the same function via a server action with a 5-minute cooldown.

## Reports page — `/reports`

Sidebar entry "Reports". Brand comes from the header switcher (same as Posts/Articles). Controls: tabs **Overview** / **Search** / **Content & social**; ranges **Last 30 days**, **Last 90 days**, **Last 12 months**, **All time** (URL params `?tab=&range=`). Header line: "Marketing data synced {last_ok_at}" and, if any source has `last_error`, a banner listing them with the message and a "Set these up in Connections" link.

Every "vs previous period" is the immediately preceding window of equal length; "same period last year" is the window shifted −1 year (shown only when rows exist for it). Percent change hides when the previous value is 0.

**Overview**
- KPI tiles: Ad spend (Meta + Google), Meta cost/lead, Google Ads cost/lead, Website leads; each with the vs-previous delta and a one-line sub-label (e.g. "133 leads on $18,795").
- Paid media: **Spend by month** grouped bars (Meta vs Google Ads), one axis, no conversions overlaid; **By platform** table (spend, link clicks, CTR, CPC, arrived%, leads, cost/lead) where arrived% = GA4 sessions from that platform's channel ÷ platform clicks; **Meta campaigns** and **Google Ads campaigns** tables sorted by spend (— for zero leads, never "$0 cost/lead").
- Website: **Traffic by channel** horizontal bars labelled with sessions and share, paid channels one hue, earned/direct another; table with sessions, vs previous period, vs same period last year; **Paid against earned by month** two-line chart.
- Organic social: Posts published (from `posts`), typical FB post engagement, typical IG post engagement — median of `post_targets.insights` (likes + comments + shares/saved) over targets published in range; "—" with a note when Facebook withholds.
- "How to read these numbers" footnotes (cost/lead per platform never summed; lead = form submission / key event; Meta restates recent days; posts < 72h old excluded from engagement medians).

**Search** (Search Console)
- Tiles: Clicks, Impressions, CTR, Average position — vs previous period.
- **Clicks & impressions by week** two-line chart (weekly buckets for 30/90d, monthly for 12mo/all).
- **Top queries** (clicks, impressions, CTR, position, vs previous clicks) and **Top pages** tables, 25 rows, search box.
- Empty state explains the 2-day lag and links to Connections.

**Content & social**
- Posts published in range by platform, median engagement per platform, top 10 posts by engagement with links (from Phase 2 data). Articles published in range (from `articles.published_at`). This tab has no external dependency.

Charts: `src/components/reports/charts/` — `GroupedBars`, `HorizontalBars`, `LineChart` as inline SVG server components with a client `ShowNumbers` toggle rendering the underlying table. Colours from CSS variables; each bar/point labelled so the chart reads without colour.

## Google Business Profile (flagged)

Only when `GBP_ENABLED=true`: `gbp` provider card with "Connect Google" (OAuth code flow, scopes `business.manage`), stores the refresh token; location list with per-location "post here" checkboxes. On post approval (Phase 2 `approvePost`), a `gbp` target is created per enabled location; the publisher posts a `localPosts.create` with the FB caption, first image, and `link_url` as CTA. Failures are per-target like Meta. Requires Google's Business Profile API access on the Cloud project; the Settings page shows the steps to request it.

## Testing

- Unit: period maths (`ranges.ts`: window/previous/last-year, week/month bucketing); mappers from GA4/GSC/Meta API responses to `metrics_daily` rows (fixtures); KPI aggregation (`aggregate.ts`: sums, medians, cost/lead with zero-safe "—", arrived%); channel paid/earned classification; sync window selection (incremental vs backfill, GSC lag).
- API clients: `fetchImpl` injection with recorded fixture responses, including the GA4 "no Ads link" error and the GSC 403.
- E2E: Reports empty state for a brand with no connections; seeded `metrics_daily` rows render tiles and tables (seed via service role in the test, cleaned by teardown pattern `e2e-brand-*` cascade).
- Live: connect JamSam Digital's GA4 property + Search Console with the service account, run "Sync now", see real numbers; Meta Ads with the JamSam ad account if one exists.

## Dependencies

`google-auth-library` (JWT for the service account). Everything else is `fetch`.
