# JamSam Social — Phase 6: Pinterest

**Date:** 2026-09-14
**Status:** Approved in conversation; written for execution
**Builds on:** Phase 2 (status machine, cron publisher, calendar, insights), Phase 4 (jobs, MCP tools), Phase 5b (content bank)

## Purpose

Draft, approve, schedule and publish Pinterest pins per brand, sync boards, read pin analytics, and let Claude write pins from media assets or content-bank projects following the brand's `pin_spec`. Pinterest has no native scheduling, so pins publish from our cron like posts.

## Decisions carried from brainstorming

- Auth: **OAuth via one JamSam Pinterest app** (`PINTEREST_APP_ID` 1611801, `PINTEREST_APP_SECRET`); refresh tokens auto-renew; paste-a-token remains a fallback.
- Scope: boards sync + pin drafts + approve/schedule/publish; pin analytics; AI `pin` jobs; bulk pin jobs from the content bank.

## Out of scope

Video/idea pins, Pinterest ads, board creation from the app, secret boards, sections, pin editing after publish (Pinterest API allows title/description edits — later).

## Data model

```sql
create type pin_status as enum ('draft','pending_approval','approved','publishing','published','failed','archived');
alter type job_type add value if not exists 'pin';

create table pin_boards (
  brand_id   uuid not null references brands(id) on delete cascade,
  board_id   text not null,
  name       text not null,
  privacy    text,
  pin_count  int,
  synced_at  timestamptz not null default now(),
  primary key (brand_id, board_id)
);

create table pins (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references brands(id) on delete cascade,
  board_id            text not null,
  board_name          text,
  title               text not null,
  description         text not null,
  link                text,
  alt_text            text,
  image_url           text not null,
  media_asset_id      uuid references media_assets(id) on delete set null,
  project_id          uuid references projects(id) on delete set null,
  source              post_source not null default 'manual',
  status              pin_status not null default 'draft',
  scheduled_at        timestamptz,
  published_at        timestamptz,
  external_id         text,
  external_url        text,
  error               text,
  attempts            int not null default 0,
  claimed_at          timestamptz,
  insights            jsonb,
  insights_fetched_at timestamptz,
  created_by          uuid references auth.users(id),
  approved_by         uuid references auth.users(id),
  approved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index pins_brand_status on pins (brand_id, status, scheduled_at);

-- Cron helpers, mirroring posts
create function claim_due_pins(max_rows int default 10) returns setof pins ...;   -- status='approved', scheduled_at <= now(), attempts < 3 → 'publishing'
create function reset_stale_pins() returns int ...;                              -- 'publishing' older than 10 min → 'approved'
```

Pinterest connection config gains `username`, `account_type`, `connected_via: 'oauth' | 'token'`; secret `{ access_token, refresh_token?, expires_at? }` (existing shape).

## Status machine

`draft → pending_approval → approved (requires scheduled_at) → publishing → published | failed (retry → approved)`; `archived` from any non-publishing state. Editing an approved/pending pin returns it to draft. Publish now = approve with `scheduled_at = now()`.

## Pinterest API (v5)

- OAuth: `https://www.pinterest.com/oauth/` (scopes `boards:read boards:write pins:read pins:write user_accounts:read`), token `POST /v5/oauth/token` with Basic app auth; `refresh_token` grant. Refresh when `expires_at` is within 3 days (checked before every API call via `withPinterestToken(brandId)`), persisting the new token; on refresh failure mark the connection `failing` with "Reconnect Pinterest".
- Boards: `GET /v5/boards?page_size=100` (paginate by `bookmark`).
- Create pin: `POST /v5/pins` `{ board_id, title, description, link, alt_text, media_source: { source_type: "image_url", url } }` → `{ id }`; external URL `https://www.pinterest.com/pin/{id}/`.
- Analytics: `GET /v5/pins/{id}/analytics?start_date&end_date&metric_types=IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK` → `all.lifetime_metrics`; stored as `{ impressions, saves, pin_clicks, outbound_clicks, fetched_at }`. Nightly for pins published in the last 90 days (same insights cron as posts).

## Pin rules (enforced in `validatePin`)

Title 1–100 chars; description 1–500 chars with a warning outside 100–300; no emoji; no `#hashtags`; link must be `https://` and, when the brand has `website_url`, on that host (warning otherwise); alt text ≤ 500. Hard failures reject `create_pin` / submit; warnings are returned.

## AI

Job type `pin`: input `{ media_asset_id?: uuid, project_id?: uuid, board_id?: string, notes?: string }` (exactly one of asset/project), result `{ pin_id }`, terminal tool `create_pin`. Brief carries the asset (url, alt, tags) or project (title, dims, location, description, images), `boards` (with measured pins + median impressions), `pin_spec`, recent pin titles (avoid repeats), and instructions: lead with dimensions when known, description 100–300 chars indexed as search text, no emoji/hashtags, link to the project page or website, never invent a dimension or colour.

MCP tools: `list_pin_boards(brand)`, `create_pin(brand, board_id, title, description, image_url | media_asset_id, link?, alt_text?, project_id?)` (lands as draft), `list_unpinned(brand, kind: 'media' | 'projects', limit)`.

Bulk: Content bank tab gets checkboxes + "Queue pin jobs for selected" (one `pin` job per project; optional board). Media library card gets "Write a pin".

## UI

- **/pins** (sidebar "Pins"): list with status filters, thumbnail, board, schedule, insights summary; **New pin**: image picker (media library or content-bank project → first image), board select (from `pin_boards`, with "Sync boards"), title with counter, description with 100–300 guide, link, alt text, schedule (brand timezone), ✨ Write pin (queues a `pin` job for the chosen asset/project and fills fields when done).
- **/pins/[id]**: actions Submit for approval / Approve (needs schedule) / Publish now / Retry / Archive; status, external link, insights.
- Calendar: pin chips (icon "PIN") alongside post targets; drag-reschedule like targets.
- Connection card: Connect Pinterest (OAuth) or paste token; boards list with pin count, measured pins, median impressions; Sync boards.
- Reports → Content & social: pins published in range + median impressions; top pins.

## Testing

Unit: `validatePin`, `buildPinPayload`, token-refresh decision, `processPin` with fake client (published / retry / failed / not connected), analytics mapper, board medians, tools with fake store, brief for pin jobs. E2E: create pin draft → submit → approve with schedule → appears on calendar → archive (no Pinterest call). Live (after Pinterest approves trial access): connect, sync boards, publish one pin to a test board, fetch analytics.
