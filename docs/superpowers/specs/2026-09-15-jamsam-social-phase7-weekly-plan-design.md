# JamSam Social — Phase 7: Weekly Plan

**Date:** 2026-09-15
**Status:** Approved in conversation; written for execution
**Builds on:** Phase 2 (posts, targets, cron publisher, calendar, insights), Phase 4 (jobs, MCP), Phase 5b (projects content bank, content mix), Phase 6 (project-linked pins)

## Purpose

Build each brand's social week automatically so the only human work is approving. The planner fills the brand's posting slots in priority order — new project pages, proven posts due for a re-run, promo posts for fresh articles, then filler chosen to keep the week balanced — writes them as ordinary draft posts with queued caption jobs, and lets a human approve a post, a day, or the whole week. Posting times start from a per-brand schedule and are refined from the brand's own measured engagement once there is enough of it. Past Facebook/Instagram posts are imported so the recycle pool, "on this day" and timing evidence exist from day one.

Modelled on SSA Social's Plan page.

## Approval guarantee (hard rule)

The planner never publishes anything. It only creates a queue for a person to approve:

- Every post the planner or its cron creates lands as `draft` (no caption yet) or `pending_approval` (recycles, promos). The planner, the cron, the caption/promo jobs and the Meta history import never set `status = 'approved'` and never write `approved_by` / `approved_at`.
- The publisher cron picks up `approved` targets only (unchanged from Phase 2), so a planned post cannot go out until a signed-in user clicks Approve on it, on its day, or on its week.
- Approve-day / approve-week are explicit clicks by a user; there is no setting that auto-approves, and none will be added in this phase.
- Enforced in code by a unit test on `buildWeekForBrand` / `rebuildWeek` asserting no created post or target has an approved/publishing status, and by the e2e test checking that a freshly built week shows 0 approved until the user approves it.

## Decisions carried from brainstorming

- **Slots:** brand schedule (days × times per platform) + engagement tuning once a brand has ≥ 50 measured posts; the source is always shown.
- **Lanes, in priority order:** new project pages → recycles → promo posts for new articles → filler from never-posted projects.
- **History:** import each brand's past Facebook and Instagram posts from the Meta Graph API into `social_history`; nightly top-up.
- **Trigger:** cron builds next week every Monday for every brand with a schedule; opening an unbuilt week in the UI offers *Build this week*. Captions for new-page/filler slots are written by Claude through the existing `caption` job.
- **Architecture:** the planner is a pure, tested function; its output is materialised as normal `posts` + `post_targets`, so calendar, approvals, publisher, insights and MCP tools need no changes (approach A). No separate slots table.
- **Approval:** unchanged model (`draft → pending_approval → approved`); the Plan page adds approve-day and approve-week, which only act on posts that already have captions. Nothing the planner creates is ever auto-approved or auto-published (see Approval guarantee).

## Out of scope

Pinterest in the planner (pins keep their own flow), paid boosting, per-post A/B timing, GBP slots, multi-week planning beyond "next week", an inbox, and any Claude-driven picking of candidates.

## Data model

Migration `0011_weekly_plan.sql`:

```sql
-- Per-brand posting cadence and planner rules
create table brand_schedules (
  brand_id           uuid primary key references brands(id) on delete cascade,
  slots              jsonb not null default '[]'::jsonb,   -- [{dow:0-6, platform:'facebook'|'instagram', time:'15:30'}]
  recycle_cap        int  not null default 3,              -- max recycles per week
  rest_days_min      int  not null default 60,
  rest_days_max      int  not null default 90,
  history_synced_at  timestamptz,
  history_cursor     jsonb,                                -- {facebook: next_url|null, instagram: next_url|null}
  updated_at         timestamptz not null default now()
);

-- Every post that has ever gone out on the brand's Page / IG account, imported or JamSam-published
create table social_history (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  platform      social_platform not null,
  external_id   text not null,
  published_at  timestamptz not null,
  caption       text not null default '',
  media         jsonb not null default '[]'::jsonb,        -- [{url, kind:'image'|'video'|'carousel'}]
  permalink     text,
  likes         int not null default 0,
  comments      int not null default 0,
  shares        int not null default 0,
  reach         int,
  interactions  int generated always as (likes + comments + shares) stored,
  post_id       uuid references posts(id) on delete set null,  -- set when JamSam published it
  fetched_at    timestamptz not null default now(),
  unique (brand_id, platform, external_id)
);
create index social_history_brand_published on social_history (brand_id, published_at desc);

-- Which project a post shows, mirroring pins.project_id; the planner's "has this been posted" join
alter table posts add column project_id uuid references projects(id) on delete set null;
create index posts_project on posts (project_id) where project_id is not null;

-- Planner provenance on the post itself
alter table posts add column plan jsonb;
-- {week_start:'2026-09-14', lane:'new_page'|'recycle'|'promo'|'filler', reason:text, candidate_id:text, touched:boolean}

-- One row per built week per brand
create table plan_weeks (
  brand_id       uuid not null references brands(id) on delete cascade,
  week_start     date not null,                           -- Monday, brand-local
  built_at       timestamptz not null default now(),
  built_by       text not null,                           -- 'cron' | user id
  timing_source  text not null,                           -- "Brand schedule" | "Refined from 335 measured posts"
  skipped        jsonb not null default '[]'::jsonb,      -- candidate_ids the user skipped; never re-offered this week
  summary        jsonb not null,                          -- {new_page:n, recycle:n, promo:n, filler:n, slots:n}
  primary key (brand_id, week_start)
);
```

RLS: authenticated read on all three; writes through the service role (server actions / cron), as with every other table.

`database.types.ts` is hand-updated to match (no `gen types`).

## Planner (pure functions, `src/lib/plan/`)

### `timing.ts`
`resolveSlots(schedule, history, weekStart, tz) → { slots: Slot[], source: string, dayRanking }`

- Base: `schedule.slots` expanded to concrete `Date`s for the week in the brand's timezone.
- If `history` has ≥ 50 rows with `interactions > 0` (or `reach`), per platform: median interactions by weekday and by hour bucket (2-hour buckets). Slot times move to the centre of the best bucket for that weekday; days rank by median. Days with < 5 samples are `low_sample` and are never ranked first. Source becomes `Refined from N measured posts`.
- Otherwise source is `Brand schedule`.

### `candidates.ts`
Each lane returns `Candidate[]` (`{ id, lane, reason, project?, history?, article?, media[] }`), already ranked:

1. **new_page** — projects with `imported_at` within 30 days of `weekStart` and no `posts.project_id` match (any status except `archived`), oldest first.
2. **recycle** — `social_history` rows published between `rest_days_min` and `rest_days_max` days ago, or older, whose `interactions` are in the brand's top quartile for that platform, not already recycled in the last 180 days (`posts.recycled_from` / `plan.candidate_id`), ranked by interactions desc. Capped at `recycle_cap` per week. The pool listing (“What’s in the recycle pool”) is this list uncapped.
3. **promo** — articles with `status = 'published'` in the last 14 days and no post whose `plan.lane = 'promo'` references them.
4. **filler** — never-posted projects (no `posts.project_id`, no `pins.project_id` within 90 days) scored by category balance (reuse `computeContentMix().favour_next` over the brand's last 20 posts) then state spread (prefer states not seen in the last 4 weeks), then recency.

### `build.ts`
`buildWeek({ slots, candidates, skipped, existing }) → Pick[]`

- A "post" occupies one slot pair per day (FB + IG on the same day, each at its own slot time); if a day has only one platform slot, that's the pair.
- Fill days in `dayRanking` order, lanes in priority order, skipping any `candidate_id` in `skipped` and any already present in `existing` (posts already planned/edited for that week).
- Recycles never exceed `recycle_cap` even if slots remain; filler fills the rest; days left empty are reported, not invented.
- Deterministic given inputs (no randomness) so rebuilds are reproducible and testable.

### "On this day"
`onThisDay(history, date, years = 3)` → history rows within ±1 calendar day in previous years, with `interactions` and a "vs usual" ratio against the platform's median. Presented as alternatives; *Use this instead* swaps the day's post for a recycle of that row.

## Materialisation (`src/lib/plan/actions.ts`)

`buildWeekForBrand(brandId, weekStart, by)`:
1. Load schedule, history, projects, articles, existing planned posts, and `plan_weeks.skipped`.
2. `resolveSlots` → `candidates` → `buildWeek`.
3. For each pick:
   - **new_page / filler:** insert `posts` (`status='draft'`, `source='ai'`, `project_id`, `media` = up to 4 project images, `title` = project title, `plan` set) + two `post_targets` (`scheduled_at` per slot, empty caption) + one queued `caption` job `{ post_id }`.
   - **recycle:** `recyclePost()` semantics from a `social_history` row: new post with `source='recycled'`, captions and media copied, `status='pending_approval'`, `plan.candidate_id = history.id`, `recycled_from` = original `post_id` when known.
   - **promo:** queue the existing `promo` job with `scheduled_after` = the slot and a new optional `plan` field on `promoInputSchema`; `create_post` copies it onto the post.
4. Upsert `plan_weeks` with `timing_source` and `summary`.

`rebuildWeek(brandId, weekStart)`: delete planned posts for that week where `plan.touched` is false and status is `draft`/`pending_approval` (cancelling their queued jobs), then `buildWeekForBrand`. Anything approved or edited stays and its candidate is treated as `existing`.

`skipPlannedPost(postId)`: archive the post, append its `candidate_id` to `plan_weeks.skipped`.

`useInstead(postId, historyId)`: skip the post, then materialise a recycle of `historyId` into the same slots.

`approveDay(brandId, date)` / `approveWeek(brandId, weekStart)`: run the existing approve action over every planned post on those days whose targets all have non-empty captions; report how many were skipped for missing captions.

Editing a planned post anywhere (form save, caption submit, reschedule) sets `plan.touched = true` — done in the existing post update path.

## Meta history import (`src/lib/meta/history.ts`)

- Facebook: `GET /{page_id}/posts?fields=message,created_time,permalink_url,attachments{media_type,media,subattachments},likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions_unique)&limit=25`.
- Instagram: `GET /{ig_user_id}/media?fields=caption,timestamp,permalink,media_type,media_url,thumbnail_url,like_count,comments_count,insights.metric(reach)&limit=25` (reach only for non-carousel media; carousel reach is omitted).
- `importHistoryChunk(brandId, platform)` fetches one page, upserts into `social_history`, stores `paging.next` in `brand_schedules.history_cursor`, and returns `{ imported, done }`. The brand-page button loops chunks until `done` (each call well under the 60 s limit); the nightly insights cron runs one chunk per platform for the last 30 days (`since` param) to top up.
- JamSam-published targets are mirrored into `social_history` at publish time (`post_id` set) and their `insights` refresh updates the same row, so ranking has one table to read.
- Uses the brand's existing Page token; requires no new scopes (`pages_read_engagement`, `instagram_basic`, `instagram_manage_insights` are already granted for insights).

## Cron

`/api/cron/plan` (POST, `isCronAuthorized`), scheduled by pg_cron every Monday at 13:00 UTC (≈ 06:00 Pacific; brands in other timezones still get the week built before their Monday slots). For each active brand with a non-empty schedule and no `plan_weeks` row for next Monday: `buildWeekForBrand(brand, nextMonday, 'cron')`. Errors are per-brand and recorded in `sync_runs` (`source='plan'`).

## UI

- **`/plan`** (new nav item between Calendar and Posts): brand switcher; week nav (Previous / this week / Next, count of planned weeks); lane counters (New pages / Recycles / Promo / Filler); a note with the ranking basis and `timing_source`; *Rebuild this week* and *What's in the recycle pool* (drawer listing the uncapped pool with interactions and last-run date); "N of M scheduled" bar with *Approve week*. Per day: header with *Approve day* and *Add another* (opens New post with the slot pre-filled); each post card shows lane badge, title, reason line, FB/IG times, caption status (Waiting on Claude / Ready / Approved), Preview, Edit, Skip; below it the *On this day* rows with *Use this instead*.
- **Brand page → Schedule card:** slot editor (weekday × platform × time), recycle cap, rest window, *Import Meta history* with progress (rows imported per platform, last synced), and a note when the brand has under 50 measured posts.
- **Dashboard:** no new widgets; planned drafts with queued caption jobs already surface as "waiting on Claude" via the jobs count, and pending approvals count as today.
- **Posts page / post form:** lane badge on planned posts; `project_id` shown as a link to the project.

## AI / MCP

- No new tools. The `caption` brief gains `plan: { lane, reason }` and the project facts (already available through `search_projects`) so captions can say "just finished" vs "throwback" appropriately; `list_jobs` shows the lane.
- Instructions for caption jobs: for `recycle`, keep the original hook if it performed; for `new_page`, lead with the build facts; never invent dimensions or towns (existing rule).

## Testing

- **Unit (`src/lib/plan/*.test.ts`):** `resolveSlots` (schedule-only, refined, low-sample guard, timezone), each candidate lane (windows, quartile, cap, not-recycled-recently, category/state balance), `buildWeek` (lane priority, cap, skipped and existing exclusion, determinism), `onThisDay` (±1 day, ratios).
- **Store/actions with the fake store:** materialisation creates the right posts/targets/jobs; rebuild removes only untouched drafts and keeps approved/edited ones; skip records the candidate; approve-week ignores captionless posts and reports the count.
- **Meta history:** parser fixtures for FB and IG payloads (carousel, video, missing insights), cursor persistence, idempotent upsert.
- **E2E:** create an e2e brand with a schedule and seeded projects/history → build the week → approve the week → posts appear on the calendar → teardown removes `plan_weeks`, `social_history`, `brand_schedules` rows along with the brand.
