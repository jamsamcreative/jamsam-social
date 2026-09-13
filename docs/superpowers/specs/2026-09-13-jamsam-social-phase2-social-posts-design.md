# JamSam Social — Phase 2: Social Posts

**Date:** 2026-09-13
**Status:** Approved in conversation; written for execution
**Builds on:** Phase 1 (`2026-09-12-jamsam-social-phase1-foundation-design.md`)

## Purpose

Let the JamSam Digital team compose, approve, schedule, and publish image posts to each client's Facebook Page and Instagram professional account, see them on a calendar, recycle past posts, and read basic performance metrics. Meta accounts connect through an OAuth "Connect Facebook" button instead of pasted tokens.

## Decisions carried from brainstorming

- Approval workflow: **full** (`draft → pending_approval → approved → publishing → published | failed`, plus `archived`).
- Media: **1 to 10 images** per post (single photo or carousel); no video in this phase.
- Extras in scope: **calendar**, **recycle / re-run**, **Meta OAuth connect**, **post insights**.
- Vercel plan is Hobby (cron once/day), so publishing is triggered by **Supabase pg_cron → pg_net HTTP call** every minute.
- Meta app: `META_APP_ID=1813832196634966`, secret in env. App is in Development mode; only accounts under App roles can connect. Live mode (Business Verification + App Review) is out of scope.

## Out of scope

Video/Reels, comment management, AI generation (Phase 4), client-facing approval, Pinterest (Phase 6).

## Data model

```sql
create type post_status   as enum ('draft','pending_approval','approved','publishing','published','failed','archived');
create type post_source   as enum ('manual','recycled','ai');
create type social_platform as enum ('facebook','instagram');
create type target_status as enum ('pending','publishing','published','failed');

create table posts (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  title         text not null,
  link_url      text,
  media         jsonb not null default '[]',   -- [{ url, alt, media_asset_id? }] 0..10, display order
  source        post_source not null default 'manual',
  recycled_from uuid references posts(id) on delete set null,
  status        post_status not null default 'draft',
  created_by    uuid references auth.users(id),
  approved_by   uuid references auth.users(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index posts_brand_status_idx on posts (brand_id, status, created_at desc);

create table post_targets (
  id                  uuid primary key default gen_random_uuid(),
  post_id             uuid not null references posts(id) on delete cascade,
  platform            social_platform not null,
  caption             text not null default '',
  scheduled_at        timestamptz,
  status              target_status not null default 'pending',
  external_id         text,           -- FB post id / IG media id
  external_url        text,
  published_at        timestamptz,
  error               text,
  attempts            int not null default 0,
  claimed_at          timestamptz,    -- set when a cron run takes the row; cleared on finish
  insights            jsonb,          -- { likes, comments, shares?, reach?, saved?, fetched_at }
  insights_fetched_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (post_id, platform)
);
create index post_targets_due_idx on post_targets (status, scheduled_at) where status = 'pending';
```

RLS: same "authenticated full access" policies as Phase 1. `updated_at` triggers on both tables.

**Post status derivation** (`derivePostStatus(targets)`), run after every target change:
- any target `publishing` → `publishing`
- all targets `published` → `published`
- any target `failed` and none `pending`/`publishing` → `failed`
- otherwise unchanged (`approved` while waiting).

**Meta connection config** gains fields from OAuth: `{ page_id, page_name, ig_user_id?, ig_username?, connected_via: 'oauth' | 'token', fb_user_id?, fb_user_name? }`. Secret: `{ page_access_token }` (Page tokens obtained from a long-lived user token do not expire).

## Meta OAuth connect

- `GET /api/auth/meta/start?brand=<slug>` — builds `https://www.facebook.com/v21.0/dialog/oauth` with `client_id`, `redirect_uri=<APP_URL>/api/auth/meta/callback`, `state` (signed: `{ brand_slug, nonce }` HMAC with `CONNECTIONS_ENCRYPTION_KEY`, nonce also set in an httpOnly cookie), `scope=pages_show_list,pages_manage_posts,pages_read_engagement,read_insights,instagram_basic,instagram_content_publish,instagram_manage_insights,business_management`, `config_id` omitted (classic scopes flow).
- `GET /api/auth/meta/callback?code&state` — verifies state + nonce; exchanges `code` → short-lived user token → long-lived user token (`grant_type=fb_exchange_token`); fetches `GET /me?fields=id,name` and `GET /me/accounts?fields=id,name,access_token,instagram_business_account{id,username}`. If exactly one Page: save directly. If several: store the candidate list encrypted in a short-lived cookie and redirect to `/brands/<slug>/connections/meta/pick`, where the user picks a Page; the chosen Page's token and IG account are saved to `brand_connections` (upsert, `status='connected'`). Then `runConnectionTest` for confirmation.
- Errors (denied dialog, no Pages, exchange failure) redirect back to the connections page with `?meta_error=<message>`, shown as a toast.
- The pasted-token form remains as a fallback below the Connect button.

## Composer and workflow

Routes: `/posts` (list, filter by brand/status), `/posts/new`, `/posts/[id]`.

**Composer fields:** title; link URL; media (pick from brand library in a dialog, or paste an image URL; reorder; max 10); per platform: include toggle, caption textarea (Instagram has "Copy from Facebook"), `scheduled_at` as `datetime-local` interpreted in the brand's timezone and stored as UTC.

**Actions (Server Actions, all return `ActionResult`):**
| Action | Allowed from | Effect |
|---|---|---|
| `savePost` | draft, pending_approval, approved (approved posts reopen to draft on edit) | upsert post + targets |
| `submitForApproval` | draft | → pending_approval; validates: ≥1 target enabled, every enabled target has caption and scheduled_at, Instagram target requires ≥1 image |
| `approvePost` | pending_approval | → approved, records approver |
| `rejectPost` | pending_approval | → draft |
| `publishNow` | approved, draft, pending_approval | sets every enabled target's `scheduled_at=now()`, status → approved; the next cron tick publishes (≤60 s) |
| `recyclePost` | published | clones post as new draft: title `Re-run: <title>`, `source='recycled'`, `recycled_from`, same media/captions, no schedule |
| `archivePost` | any except publishing | → archived |
| `retryTarget` | target failed | target → pending, attempts stays, post → approved |

Editing an approved post is allowed but drops it back to `draft` so it must be re-approved (prevents publishing unreviewed edits).

## Publisher

`POST /api/cron/publish` — requires header `Authorization: Bearer <CRON_SECRET>`.

1. Claim: `update post_targets set status='publishing', claimed_at=now(), attempts=attempts+1 where id in (select id from post_targets t join posts p on p.id=t.post_id where t.status='pending' and t.scheduled_at <= now() and p.status='approved' and t.attempts < 3 limit 10 for update skip locked) returning *`. Done via a SQL function `claim_due_targets(max int)` so it is atomic.
2. For each claimed target: load brand's Meta connection (`getConnectionWithSecret`), call the platform publisher, then update the target (`published` + `external_id/url/published_at`, or `failed` + `error`; a target that failed with `attempts < 3` goes back to `pending` for the next tick, `>= 3` stays `failed`). Then `derivePostStatus` on the post.
3. Stale claims: any target `publishing` with `claimed_at < now() - interval '10 minutes'` is reset to `pending` at the start of a run (a crashed run).
4. Response: `{ claimed, published, failed }` counts.

**Facebook** (`lib/publishers/facebook.ts`):
- 0 images: `POST /{page_id}/feed { message, link? }`
- 1 image: `POST /{page_id}/photos { url, message }` → returns `post_id`
- 2–10: for each image `POST /{page_id}/photos { url, published:false }` → ids; then `POST /{page_id}/feed { message, attached_media:[{media_fbid}...] }`
- `external_url = https://www.facebook.com/{post_id}`

**Instagram** (`lib/publishers/instagram.ts`), requires `ig_user_id` and ≥1 image:
- 1 image: `POST /{ig_id}/media { image_url, caption }` → `creation_id`; poll `GET /{creation_id}?fields=status_code` until `FINISHED` (max 30 s); `POST /{ig_id}/media_publish { creation_id }` → media id.
- 2–10: each `POST /{ig_id}/media { image_url, is_carousel_item:true }`; then `POST /{ig_id}/media { media_type:'CAROUSEL', children:[ids], caption }`; publish as above.
- `external_url` from `GET /{media_id}?fields=permalink`.

All Graph calls go through `graphFetch(path, { token, method, body })` which appends the token, times out at 20 s, and turns `{ error: { message, code } }` into a thrown `GraphError` so the publisher records a readable error.

**Trigger:** migration creates `cron.schedule('publish-every-minute', '* * * * *', $$ select net.http_post(url:='<APP_URL>/api/cron/publish', headers:=jsonb_build_object('Authorization','Bearer <CRON_SECRET>')) $$)`. The URL and secret are inserted by the migration from a `app_settings` table row (`key='cron_url'`, `key='cron_secret'`) so the SQL file holds no secrets; the plan seeds those two rows.

## Calendar

`/calendar?month=YYYY-MM` — month grid for the current brand (header switcher). Each target is a chip: platform icon + time + title, colour by status (pending grey, published green, failed red, publishing amber). Click → `/posts/[id]`. Drag a chip onto another day → `rescheduleTarget(targetId, newDate)` keeps the time of day, brand timezone; only allowed for `pending` targets whose post is not `publishing`. Pure helpers in `lib/calendar/grid.ts` (`monthGrid(year, month, timezone)`, `moveKeepingTime(iso, newDay, timezone)`) are unit tested.

## Insights

- `POST /api/cron/insights` (same bearer secret), scheduled daily 06:00 UTC via pg_cron, plus a "Refresh insights" button on the post page.
- For targets `published` within 30 days: Facebook `GET /{post_id}?fields=likes.summary(true),comments.summary(true),shares` (+ `insights.metric(post_impressions_unique)` when the token allows); Instagram `GET /{media_id}?fields=like_count,comments_count` + `GET /{media_id}/insights?metric=reach,saved`.
- Stored in `post_targets.insights`; shown on the post page and as a small "♥ 12 · 💬 3" line on list rows.

## UI additions

- Sidebar: **Posts**, **Calendar** (between Brands and Media).
- Connections tab: Meta card gets a **Connect Facebook** button (primary) showing connected Page + IG when linked, and "Reconnect" / "Disconnect".
- Dashboard cards: "next scheduled" and counts of pending approval.

## Environment

| Name | Purpose |
|---|---|
| `META_APP_ID`, `META_APP_SECRET` | OAuth + token exchange (already set) |
| `CRON_SECRET` | bearer for `/api/cron/*` (generate: `openssl rand -hex 32`) |

## Testing

- Unit: `derivePostStatus`, submit validation, `facebook.publish` / `instagram.publish` request shapes and error handling (mocked fetch), OAuth state signing/verification and page selection, `monthGrid` / `moveKeepingTime`, `claim_due_targets` semantics (SQL tested via a Vitest test hitting the real DB is out; covered by an integration check in the plan using the seeded brand and a fake connection).
- Playwright: create post → submit → approve → shows on calendar; recycle creates "Re-run:" draft. Real publish verified manually against the JamSam Lab Page (owner adds themself under App roles).

## Definition of done

- Connect Facebook on a brand yields a green Meta connection with Page + IG shown.
- A post with two images, both platforms, scheduled 2 minutes out, publishes to the JamSam Lab Page and its Instagram within ~1 minute of the time; post shows `published` with links.
- Calendar shows it; drag reschedule works on a pending post; recycle creates a draft.
- Insights refresh fills likes/comments.
- CI green, deployed to production.
