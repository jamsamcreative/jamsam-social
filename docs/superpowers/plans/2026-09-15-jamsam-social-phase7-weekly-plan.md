# Phase 7: Weekly Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build each brand's social week automatically as a queue of draft / pending-approval posts (new project pages → recycles → promos → filler) with engagement-tuned slot times and imported Meta history, so the only human work is approving.

**Architecture:** Pure planner functions in `src/lib/plan/` (timing, candidates, build) produce `Pick`s; a `PlanStore` interface (Supabase impl + in-memory test impl) materialises them as ordinary `posts` + `post_targets` + queued `caption`/`promo` jobs, so calendar, approvals, publisher and MCP need no changes. A `/api/cron/plan` route builds next week every Monday. Meta history is imported into `social_history` in paginated chunks. The planner never sets `approved`.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before touching pages/actions), Supabase (Postgres, pg_cron + pg_net), TypeScript, zod, vitest, Playwright, shadcn/ui components already in `src/components/ui`.

**Spec:** `docs/superpowers/specs/2026-09-15-jamsam-social-phase7-weekly-plan-design.md`

## Global Constraints

- **Approval guarantee (hard rule):** nothing created by the planner, its cron, the history import, or caption/promo jobs may have `status` in (`approved`, `publishing`, `published`) or set `approved_by`/`approved_at`. Planner posts are `draft` (awaiting caption) or `pending_approval` (recycles, promos).
- Migration file is `supabase/migrations/0011_weekly_plan.sql`; `src/lib/database.types.ts` is hand-written — update it in the same task as the migration.
- Every table gets RLS with the existing `"authenticated read"` policy; writes go through the service role (`createAdminSupabase()`).
- Times: slots are brand-local (`brands.timezone`); persisted `scheduled_at` is ISO UTC via `zonedLocalToUtc(local, tz)` from `src/lib/time/zoned.ts`. `week_start` is the brand-local Monday as `YYYY-MM-DD`.
- Cron auth: `isCronAuthorized(req)` from `src/lib/cron/auth`; route `maxDuration = 60`.
- Run tests with `npx vitest run <path>`; typecheck with `npx tsc --noEmit -p .`; lint with `npx eslint <files>`.
- Commit after every green step; commit messages end with the attribution lines in the session reminder.
- Branch: `phase-7-weekly-plan` (already created off `main`).

---

## File structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/0011_weekly_plan.sql` | `brand_schedules`, `social_history`, `plan_weeks`, `posts.project_id`, `posts.plan`, cron schedule |
| `src/lib/database.types.ts` | hand-written row types for the above |
| `src/lib/plan/types.ts` | shared planner types (`ScheduleSlot`, `HistoryRow`, `ResolvedSlot`, `Candidate`, `Pick`, `Lane`) |
| `src/lib/plan/timing.ts` | `resolveSlots` — schedule → concrete slots, engagement refinement, day ranking |
| `src/lib/plan/candidates.ts` | the four lanes as pure ranking functions |
| `src/lib/plan/build.ts` | `buildWeek`, `onThisDay` |
| `src/lib/plan/store.ts` | `PlanStore` interface + `createSupabasePlanStore()` |
| `src/lib/plan/fake-store.ts` | in-memory `PlanStore` for tests |
| `src/lib/plan/materialise.ts` | `materialiseWeek`, `rebuildWeek` core (store-agnostic) |
| `src/lib/plan/actions.ts` | server actions: build/rebuild/skip/use-instead/approve-day/approve-week/save-schedule/import-history |
| `src/lib/plan/queries.ts` | read helpers for the Plan page |
| `src/lib/meta/history.ts` | Graph payload parsers + `importHistoryChunk` |
| `src/app/api/cron/plan/route.ts` | Monday build for all brands |
| `src/app/(app)/plan/page.tsx` + `src/components/plan/*` | Plan page |
| `src/components/brands/schedule-form.tsx` + brand page | Schedule card + Import Meta history |
| `e2e/plan.spec.ts`, `e2e/global-teardown.ts` | end-to-end + cleanup |

---

### Task 1: Migration, types, and store type plumbing

**Files:**
- Create: `supabase/migrations/0011_weekly_plan.sql`
- Modify: `src/lib/database.types.ts` (PostRow, Tables map)
- Create: `src/lib/plan/types.ts`

**Interfaces:**
- Produces: DB tables `brand_schedules`, `social_history`, `plan_weeks`; columns `posts.project_id`, `posts.plan`; TS types `BrandScheduleRow`, `SocialHistoryRow`, `PlanWeekRow`, and the planner types below.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0011_weekly_plan.sql
-- Phase 7: Weekly Plan — schedules, imported social history, planner provenance.

create table brand_schedules (
  brand_id           uuid primary key references brands(id) on delete cascade,
  slots              jsonb not null default '[]'::jsonb,   -- [{dow:0-6, platform:'facebook'|'instagram', time:'15:30'}]
  recycle_cap        int  not null default 3,
  rest_days_min      int  not null default 60,
  rest_days_max      int  not null default 90,
  history_synced_at  timestamptz,
  history_cursor     jsonb,                                -- {facebook: next_url|null, instagram: next_url|null}
  updated_at         timestamptz not null default now()
);

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
  post_id       uuid references posts(id) on delete set null,
  fetched_at    timestamptz not null default now(),
  unique (brand_id, platform, external_id)
);
create index social_history_brand_published on social_history (brand_id, published_at desc);

alter table posts add column project_id uuid references projects(id) on delete set null;
create index posts_project on posts (project_id) where project_id is not null;
alter table posts add column plan jsonb;
-- plan: {week_start:'YYYY-MM-DD', lane:'new_page'|'recycle'|'promo'|'filler', reason:text, candidate_id:text, touched:boolean}

create table plan_weeks (
  brand_id       uuid not null references brands(id) on delete cascade,
  week_start     date not null,
  built_at       timestamptz not null default now(),
  built_by       text not null,
  timing_source  text not null,
  skipped        jsonb not null default '[]'::jsonb,
  summary        jsonb not null,
  primary key (brand_id, week_start)
);

alter table brand_schedules enable row level security;
alter table social_history  enable row level security;
alter table plan_weeks      enable row level security;
create policy "authenticated read" on brand_schedules for select to authenticated using (true);
create policy "authenticated read" on social_history  for select to authenticated using (true);
create policy "authenticated read" on plan_weeks      for select to authenticated using (true);

-- Build next week every Monday 13:00 UTC (~06:00 Pacific). Route only creates drafts / pending approval.
select cron.schedule(
  'jamsam-plan-weekly',
  '0 13 * * 1',
  $$
  select net.http_post(
    url := (select value from public.app_settings where key = 'cron_url') || '/api/cron/plan',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select value from public.app_settings where key = 'cron_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 2: Update `src/lib/database.types.ts`**

Add to `PostRow` (after `category_id: string | null;`):

```ts
  project_id: string | null; plan: Json | null;
```

Add these row types next to `PinRow`:

```ts
type BrandScheduleRow = {
  brand_id: string; slots: Json; recycle_cap: number; rest_days_min: number; rest_days_max: number;
  history_synced_at: string | null; history_cursor: Json | null; updated_at: string;
};
type SocialHistoryRow = {
  id: string; brand_id: string; platform: "facebook" | "instagram" | "gbp"; external_id: string; published_at: string; caption: string; media: Json;
  permalink: string | null; likes: number; comments: number; shares: number; reach: number | null; interactions: number; post_id: string | null; fetched_at: string;
};
type PlanWeekRow = {
  brand_id: string; week_start: string; built_at: string; built_by: string; timing_source: string; skipped: Json; summary: Json;
};
```

Add to the `Tables:` map:

```ts
      brand_schedules: Table<BrandScheduleRow, "brand_id">;
      social_history: Table<SocialHistoryRow, "brand_id" | "platform" | "external_id" | "published_at">;
      plan_weeks: Table<PlanWeekRow, "brand_id" | "week_start" | "built_by" | "timing_source" | "summary">;
```

(`interactions` is generated; `Insert` is `Partial` for non-required keys so inserting without it type-checks.)

- [ ] **Step 3: Create planner types**

```ts
// src/lib/plan/types.ts
export type PlanPlatform = "facebook" | "instagram";
export type Lane = "new_page" | "recycle" | "promo" | "filler";

/** One recurring slot in the brand's cadence. dow: 0 = Sunday … 6 = Saturday. time: "HH:mm" brand-local. */
export type ScheduleSlot = { dow: number; platform: PlanPlatform; time: string };

export type BrandSchedule = {
  brand_id: string;
  slots: ScheduleSlot[];
  recycle_cap: number;
  rest_days_min: number;
  rest_days_max: number;
  history_synced_at: string | null;
};

export type HistoryMedia = { url: string; kind: "image" | "video" | "carousel" };
export type HistoryRow = {
  id: string;
  brand_id: string;
  platform: PlanPlatform;
  external_id: string;
  published_at: string;
  caption: string;
  media: HistoryMedia[];
  permalink: string | null;
  likes: number;
  comments: number;
  shares: number;
  reach: number | null;
  interactions: number;
  post_id: string | null;
};

/** A concrete slot for one week: date is brand-local YYYY-MM-DD, at is ISO UTC. */
export type ResolvedSlot = { date: string; dow: number; platform: PlanPlatform; at: string; low_sample: boolean };

export type ProjectLike = { id: string; title: string; url: string | null; category: string | null; state: string | null; images: { url: string; alt?: string }[]; imported_at: string };
export type ArticleLike = { id: string; title: string; published_at: string | null };

export type Candidate = {
  id: string; // stable across rebuilds: `project:<id>` | `history:<id>` | `article:<id>`
  lane: Lane;
  reason: string;
  title: string;
  media: { url: string; alt?: string }[];
  project?: ProjectLike;
  history?: HistoryRow;
  article?: ArticleLike;
};

export type Pick = { date: string; slots: ResolvedSlot[]; candidate: Candidate };

export type PlanMeta = { week_start: string; lane: Lane; reason: string; candidate_id: string; touched: boolean };
```

- [ ] **Step 4: Typecheck and apply the migration**

Run: `npx tsc --noEmit -p .` — Expected: clean.

Apply: `npx supabase db push --db-url "postgresql://postgres.dpihndeejbirskdrjfeh:<db-password, URL-encoded>@aws-0-us-east-2.pooler.supabase.com:5432/postgres" --yes` (ask the user for the DB password; never store it). Expected: `0011_weekly_plan.sql` applied.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0011_weekly_plan.sql src/lib/database.types.ts src/lib/plan/types.ts
git commit -m "feat(plan): migration 0011 — schedules, social history, plan provenance"
```

---

### Task 2: Timing — `resolveSlots`

**Files:**
- Create: `src/lib/plan/timing.ts`
- Test: `src/lib/plan/timing.test.ts`

**Interfaces:**
- Consumes: `BrandSchedule`, `HistoryRow`, `ResolvedSlot` from `types.ts`; `zonedLocalToUtc` from `@/lib/time/zoned`.
- Produces: `resolveSlots(input: { schedule: BrandSchedule; history: HistoryRow[]; weekStart: string; tz: string }): { slots: ResolvedSlot[]; source: string; dayRanking: number[]; sampleCount: number }` and helpers `median(nums: number[]): number`, `zonedParts(iso: string, tz: string): { dow: number; hour: number; date: string }`, `MIN_SAMPLES = 50`, `MIN_DAY_SAMPLES = 5`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/plan/timing.test.ts
import { describe, it, expect } from "vitest";
import { resolveSlots, median, zonedParts } from "./timing";
import type { BrandSchedule, HistoryRow } from "./types";

const TZ = "America/Los_Angeles";
const schedule: BrandSchedule = {
  brand_id: "b1", recycle_cap: 3, rest_days_min: 60, rest_days_max: 90, history_synced_at: null,
  slots: [
    { dow: 1, platform: "facebook", time: "15:30" }, { dow: 1, platform: "instagram", time: "17:30" },
    { dow: 3, platform: "facebook", time: "15:30" }, { dow: 3, platform: "instagram", time: "17:30" },
  ],
};
const row = (o: Partial<HistoryRow>): HistoryRow => ({ id: "h", brand_id: "b1", platform: "facebook", external_id: "x", published_at: "2026-06-01T22:30:00Z", caption: "", media: [], permalink: null, likes: 0, comments: 0, shares: 0, reach: null, interactions: 0, post_id: null, ...o });
/** n rows on weekday `dow` at `hourLocal` with the given interactions (spread across weeks so dates differ). */
const rows = (n: number, dow: number, hourLocal: number, interactions: number, platform: HistoryRow["platform"] = "facebook") =>
  Array.from({ length: n }, (_, i) => {
    // 2026-06-01 is a Monday (dow 1); step back whole weeks and shift to the wanted weekday
    const d = new Date(Date.UTC(2026, 5, 1 + ((dow - 1 + 7) % 7) - 7 * i, hourLocal + 7, 0)); // PDT = UTC-7
    return row({ id: `${platform}-${dow}-${hourLocal}-${i}`, platform, published_at: d.toISOString(), likes: interactions, interactions });
  });

describe("median", () => {
  it("handles odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("zonedParts", () => {
  it("returns brand-local weekday, hour and date", () => {
    expect(zonedParts("2026-06-01T22:30:00Z", TZ)).toEqual({ dow: 1, hour: 15, date: "2026-06-01" });
    expect(zonedParts("2026-06-02T06:30:00Z", TZ)).toEqual({ dow: 1, hour: 23, date: "2026-06-01" });
  });
});

describe("resolveSlots", () => {
  it("uses the brand schedule when there is too little history", () => {
    const r = resolveSlots({ schedule, history: rows(10, 1, 9, 50), weekStart: "2026-09-14", tz: TZ });
    expect(r.source).toBe("Brand schedule");
    expect(r.slots).toHaveLength(4);
    expect(r.slots[0]).toEqual({ date: "2026-09-14", dow: 1, platform: "facebook", at: "2026-09-14T22:30:00.000Z", low_sample: true });
    expect(r.dayRanking).toEqual([1, 3]);
  });
  it("refines slot times to the best hour bucket and ranks days by median interactions", () => {
    const history = [
      ...rows(30, 1, 9, 80),  // Monday mornings do best
      ...rows(30, 3, 15, 20), // Wednesday afternoons are weak
    ];
    const r = resolveSlots({ schedule, history, weekStart: "2026-09-14", tz: TZ });
    expect(r.source).toBe("Refined from 60 measured posts");
    const monFb = r.slots.find((s) => s.dow === 1 && s.platform === "facebook")!;
    expect(monFb.at).toBe("2026-09-14T16:00:00.000Z"); // 09:00 PDT = centre of the 8-10 bucket
    expect(monFb.low_sample).toBe(false);
    expect(r.dayRanking).toEqual([1, 3]);
  });
  it("never ranks a low-sample day first and leaves its time on the schedule", () => {
    const history = [...rows(55, 3, 15, 10), ...rows(3, 1, 9, 900)];
    const r = resolveSlots({ schedule, history, weekStart: "2026-09-14", tz: TZ });
    expect(r.dayRanking).toEqual([3, 1]);
    const mon = r.slots.find((s) => s.dow === 1 && s.platform === "facebook")!;
    expect(mon.low_sample).toBe(true);
    expect(mon.at).toBe("2026-09-14T22:30:00.000Z");
  });
  it("only counts rows with engagement or reach as samples", () => {
    const r = resolveSlots({ schedule, history: Array.from({ length: 60 }, (_, i) => row({ id: `z${i}` })), weekStart: "2026-09-14", tz: TZ });
    expect(r.source).toBe("Brand schedule");
    expect(r.sampleCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/plan/timing.test.ts` — Expected: FAIL, `Cannot find module './timing'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/plan/timing.ts
import { zonedLocalToUtc } from "@/lib/time/zoned";
import type { BrandSchedule, HistoryRow, ResolvedSlot } from "./types";

export const MIN_SAMPLES = 50;
export const MIN_DAY_SAMPLES = 5;
const MIN_BUCKET_SAMPLES = 3;
const BUCKET_HOURS = 2;

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Brand-local weekday (0 = Sunday), hour and YYYY-MM-DD for an ISO instant. */
export function zonedParts(iso: string, tz: string): { dow: number; hour: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { dow, hour: Number(get("hour")), date: `${get("year")}-${get("month")}-${get("day")}` };
}

/** weekStart (Monday, YYYY-MM-DD) + n days → YYYY-MM-DD, calendar arithmetic only. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Date within the week (Mon..Sun) for a weekday number. */
function dateForDow(weekStart: string, dow: number): string {
  return addDays(weekStart, (dow + 6) % 7); // Mon=0 … Sun=6 offsets
}

const pad = (n: number) => String(n).padStart(2, "0");

export function resolveSlots(input: { schedule: BrandSchedule; history: HistoryRow[]; weekStart: string; tz: string }): { slots: ResolvedSlot[]; source: string; dayRanking: number[]; sampleCount: number } {
  const { schedule, history, weekStart, tz } = input;
  const samples = history.filter((h) => h.interactions > 0 || h.reach !== null).map((h) => ({ ...zonedParts(h.published_at, tz), platform: h.platform, value: h.interactions }));
  const refined = samples.length >= MIN_SAMPLES;

  // Per-weekday medians (all platforms) drive day ranking; per platform+weekday+bucket medians move times.
  const byDay = new Map<number, number[]>();
  const byBucket = new Map<string, number[]>();
  for (const s of samples) {
    byDay.set(s.dow, [...(byDay.get(s.dow) ?? []), s.value]);
    const key = `${s.platform}:${s.dow}:${Math.floor(s.hour / BUCKET_HOURS)}`;
    byBucket.set(key, [...(byBucket.get(key) ?? []), s.value]);
  }
  const daySamples = (dow: number) => byDay.get(dow)?.length ?? 0;
  const lowSample = (dow: number) => !refined || daySamples(dow) < MIN_DAY_SAMPLES;

  const slots: ResolvedSlot[] = schedule.slots.map((slot) => {
    const date = dateForDow(weekStart, slot.dow);
    let time = slot.time;
    if (!lowSample(slot.dow)) {
      let best: { bucket: number; med: number } | null = null;
      for (let b = 0; b < 24 / BUCKET_HOURS; b++) {
        const vals = byBucket.get(`${slot.platform}:${slot.dow}:${b}`) ?? [];
        if (vals.length < MIN_BUCKET_SAMPLES) continue;
        const med = median(vals);
        if (!best || med > best.med) best = { bucket: b, med };
      }
      if (best) time = `${pad(best.bucket * BUCKET_HOURS + BUCKET_HOURS / 2)}:00`;
    }
    return { date, dow: slot.dow, platform: slot.platform, at: zonedLocalToUtc(`${date}T${time}`, tz), low_sample: lowSample(slot.dow) };
  });

  const dows = [...new Set(schedule.slots.map((s) => s.dow))];
  const scheduleOrder = (d: number) => (d + 6) % 7;
  const dayRanking = refined
    ? dows.sort((a, b) => {
        const la = lowSample(a), lb = lowSample(b);
        if (la !== lb) return la ? 1 : -1;
        const diff = median(byDay.get(b) ?? []) - median(byDay.get(a) ?? []);
        return diff !== 0 ? diff : scheduleOrder(a) - scheduleOrder(b);
      })
    : dows.sort((a, b) => scheduleOrder(a) - scheduleOrder(b));

  return { slots, source: refined ? `Refined from ${samples.length} measured posts` : "Brand schedule", dayRanking, sampleCount: samples.length };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/plan/timing.test.ts` — Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan/timing.ts src/lib/plan/timing.test.ts
git commit -m "feat(plan): resolveSlots — schedule slots refined by measured engagement"
```

---

### Task 3: Candidate lanes

**Files:**
- Create: `src/lib/plan/candidates.ts`
- Test: `src/lib/plan/candidates.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `HistoryRow`, `ProjectLike`, `ArticleLike`, `BrandSchedule` from `types.ts`; `addDays` from `timing.ts`.
- Produces:
  - `newPageCandidates(i: { projects: ProjectLike[]; postedProjectIds: Set<string>; weekStart: string }): Candidate[]`
  - `recyclePool(i: { history: HistoryRow[]; schedule: BrandSchedule; recycledHistoryIds: Set<string>; now: Date }): Candidate[]` (uncapped, ranked)
  - `promoCandidates(i: { articles: ArticleLike[]; promoedArticleIds: Set<string>; now: Date }): Candidate[]`
  - `fillerCandidates(i: { projects: ProjectLike[]; postedProjectIds: Set<string>; pinnedProjectIds: Set<string>; favourCategory: string | null; recentStates: string[] }): Candidate[]`
  - `daysBetween(a: Date, b: Date): number`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/plan/candidates.test.ts
import { describe, it, expect } from "vitest";
import { newPageCandidates, recyclePool, promoCandidates, fillerCandidates } from "./candidates";
import type { HistoryRow, ProjectLike, BrandSchedule } from "./types";

const NOW = new Date("2026-09-14T12:00:00Z");
const proj = (o: Partial<ProjectLike>): ProjectLike => ({ id: "p", title: "36x48 Shop", url: "https://x/p", category: "Garages & Shops", state: "WA", images: [{ url: "https://x/1.jpg" }], imported_at: "2026-09-10T00:00:00Z", ...o });
const hist = (o: Partial<HistoryRow>): HistoryRow => ({ id: "h", brand_id: "b1", platform: "facebook", external_id: "x", published_at: "2026-06-20T22:30:00Z", caption: "Cap", media: [{ url: "https://x/h.jpg", kind: "image" }], permalink: null, likes: 0, comments: 0, shares: 0, reach: null, interactions: 0, post_id: null, ...o });
const schedule: BrandSchedule = { brand_id: "b1", slots: [], recycle_cap: 3, rest_days_min: 60, rest_days_max: 90, history_synced_at: null };
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("newPageCandidates", () => {
  it("returns projects imported in the last 30 days that have no post, oldest first", () => {
    const projects = [proj({ id: "new2", imported_at: daysAgo(2) }), proj({ id: "new20", imported_at: daysAgo(20) }), proj({ id: "old", imported_at: daysAgo(40) }), proj({ id: "posted", imported_at: daysAgo(3) })];
    const out = newPageCandidates({ projects, postedProjectIds: new Set(["posted"]), weekStart: "2026-09-14" });
    expect(out.map((c) => c.id)).toEqual(["project:new20", "project:new2"]);
    expect(out[0]).toMatchObject({ lane: "new_page", title: "36x48 Shop", media: [{ url: "https://x/1.jpg" }] });
    expect(out[0].reason).toMatch(/new project page/i);
  });
});

describe("recyclePool", () => {
  it("keeps rested top-quartile posts, excludes already recycled, ranks by interactions", () => {
    const history = [
      hist({ id: "star", published_at: daysAgo(70), likes: 90, interactions: 90 }),
      hist({ id: "old-star", published_at: daysAgo(400), likes: 80, interactions: 80 }),
      hist({ id: "recent", published_at: daysAgo(30), likes: 100, interactions: 100 }),
      hist({ id: "used", published_at: daysAgo(75), likes: 95, interactions: 95 }),
      ...Array.from({ length: 8 }, (_, i) => hist({ id: `meh${i}`, published_at: daysAgo(100 + i), likes: 2, interactions: 2 })),
    ];
    const out = recyclePool({ history, schedule, recycledHistoryIds: new Set(["used"]), now: NOW });
    expect(out.map((c) => c.id)).toEqual(["history:star", "history:old-star"]);
    expect(out[0]).toMatchObject({ lane: "recycle", title: "Cap", media: [{ url: "https://x/h.jpg" }] });
    expect(out[0].reason).toMatch(/70 days ago/);
    expect(out[0].reason).toMatch(/top 25%/);
  });
  it("quartile is per platform", () => {
    const history = [
      ...Array.from({ length: 4 }, (_, i) => hist({ id: `fb${i}`, published_at: daysAgo(100), likes: 100, interactions: 100 })),
      ...Array.from({ length: 4 }, (_, i) => hist({ id: `ig${i}`, platform: "instagram", published_at: daysAgo(100), likes: 5 + i, interactions: 5 + i })),
    ];
    const out = recyclePool({ history, schedule, recycledHistoryIds: new Set(), now: NOW });
    expect(out.some((c) => c.id === "history:ig3")).toBe(true);
  });
});

describe("promoCandidates", () => {
  it("returns articles published in the last 14 days without a promo post", () => {
    const articles = [
      { id: "a1", title: "Fresh", published_at: daysAgo(3) },
      { id: "a2", title: "Promoted", published_at: daysAgo(5) },
      { id: "a3", title: "Stale", published_at: daysAgo(20) },
      { id: "a4", title: "Draft", published_at: null },
    ];
    const out = promoCandidates({ articles, promoedArticleIds: new Set(["a2"]), now: NOW });
    expect(out.map((c) => c.id)).toEqual(["article:a1"]);
    expect(out[0]).toMatchObject({ lane: "promo", title: "Fresh", media: [] });
  });
});

describe("fillerCandidates", () => {
  it("prefers the favoured category and states not seen recently, skips posted or recently pinned projects", () => {
    const projects = [
      proj({ id: "wa-shop", category: "Garages & Shops", state: "WA" }),
      proj({ id: "id-barn", category: "Barns", state: "ID" }),
      proj({ id: "co-barn", category: "Barns", state: "CO" }),
      proj({ id: "posted", category: "Barns", state: "MT" }),
      proj({ id: "pinned", category: "Barns", state: "MT" }),
    ];
    const out = fillerCandidates({ projects, postedProjectIds: new Set(["posted"]), pinnedProjectIds: new Set(["pinned"]), favourCategory: "Barns", recentStates: ["WA", "ID"] });
    expect(out.map((c) => c.id)).toEqual(["project:co-barn", "project:id-barn", "project:wa-shop"]);
    expect(out[0]).toMatchObject({ lane: "filler" });
    expect(out[0].reason).toMatch(/Barns/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/plan/candidates.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/plan/candidates.ts
import type { ArticleLike, BrandSchedule, Candidate, HistoryRow, ProjectLike } from "./types";

export const NEW_PAGE_WINDOW_DAYS = 30;
export const PROMO_WINDOW_DAYS = 14;

export const daysBetween = (a: Date, b: Date) => Math.floor(Math.abs(a.getTime() - b.getTime()) / 86_400_000);

const projectMedia = (p: ProjectLike) => p.images.slice(0, 4).map((i) => ({ url: i.url, alt: i.alt }));

export function newPageCandidates(i: { projects: ProjectLike[]; postedProjectIds: Set<string>; weekStart: string }): Candidate[] {
  const cutoff = new Date(`${i.weekStart}T00:00:00Z`).getTime() - NEW_PAGE_WINDOW_DAYS * 86_400_000;
  return i.projects
    .filter((p) => !i.postedProjectIds.has(p.id) && Date.parse(p.imported_at) >= cutoff)
    .sort((a, b) => Date.parse(a.imported_at) - Date.parse(b.imported_at))
    .map((p) => ({ id: `project:${p.id}`, lane: "new_page", reason: `New project page (added ${p.imported_at.slice(0, 10)}) that has never been posted.`, title: p.title, media: projectMedia(p), project: p }));
}

function percentile(vals: number[], p: number): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

/** Rested (≥ rest_days_min ago), top-quartile-for-its-platform history rows not already recycled, best first. Uncapped. */
export function recyclePool(i: { history: HistoryRow[]; schedule: BrandSchedule; recycledHistoryIds: Set<string>; now: Date }): Candidate[] {
  const p75 = new Map<string, number>();
  for (const platform of ["facebook", "instagram"] as const) p75.set(platform, percentile(i.history.filter((h) => h.platform === platform).map((h) => h.interactions), 0.75));
  return i.history
    .filter((h) => {
      const age = daysBetween(i.now, new Date(h.published_at));
      return age >= i.schedule.rest_days_min && !i.recycledHistoryIds.has(h.id) && h.interactions > 0 && h.interactions >= (p75.get(h.platform) ?? 0);
    })
    .sort((a, b) => b.interactions - a.interactions || Date.parse(a.published_at) - Date.parse(b.published_at))
    .map((h) => {
      const age = daysBetween(i.now, new Date(h.published_at));
      const inWindow = age <= i.schedule.rest_days_max;
      return {
        id: `history:${h.id}`, lane: "recycle" as const, title: h.caption.split("\n")[0].slice(0, 80) || "Re-run", media: h.media.map((m) => ({ url: m.url })), history: h,
        reason: `Ran ${age} days ago with ${h.interactions} interactions (top 25% for this brand on ${h.platform})${inWindow ? ", inside the preferred rest window" : ""}.`,
      };
    });
}

export function promoCandidates(i: { articles: ArticleLike[]; promoedArticleIds: Set<string>; now: Date }): Candidate[] {
  return i.articles
    .filter((a) => a.published_at && !i.promoedArticleIds.has(a.id) && daysBetween(i.now, new Date(a.published_at)) <= PROMO_WINDOW_DAYS)
    .sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!))
    .map((a) => ({ id: `article:${a.id}`, lane: "promo" as const, reason: `Article published ${a.published_at!.slice(0, 10)} with no promo post yet.`, title: a.title, media: [], article: a }));
}

/** Never-posted projects, favouring the under-served category, then states not seen lately, then newest. */
export function fillerCandidates(i: { projects: ProjectLike[]; postedProjectIds: Set<string>; pinnedProjectIds: Set<string>; favourCategory: string | null; recentStates: string[] }): Candidate[] {
  const recent = new Set(i.recentStates);
  const score = (p: ProjectLike) => (p.category && p.category === i.favourCategory ? 2 : 0) + (p.state && !recent.has(p.state) ? 1 : 0);
  return i.projects
    .filter((p) => !i.postedProjectIds.has(p.id) && !i.pinnedProjectIds.has(p.id))
    .sort((a, b) => score(b) - score(a) || Date.parse(b.imported_at) - Date.parse(a.imported_at) || a.id.localeCompare(b.id))
    .map((p) => ({
      id: `project:${p.id}`, lane: "filler" as const, title: p.title, media: projectMedia(p), project: p,
      reason: `Never posted. Picked to balance the week${p.category === i.favourCategory && p.category ? ` (${p.category} is under target)` : ""}${p.state && !recent.has(p.state) ? ` and to show ${p.state}` : ""}.`,
    }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/plan/candidates.test.ts` — Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan/candidates.ts src/lib/plan/candidates.test.ts
git commit -m "feat(plan): candidate lanes — new pages, recycle pool, promos, filler"
```

---

### Task 4: `buildWeek` and `onThisDay`

**Files:**
- Create: `src/lib/plan/build.ts`
- Test: `src/lib/plan/build.test.ts`

**Interfaces:**
- Consumes: `ResolvedSlot`, `Candidate`, `Pick`, `HistoryRow` from `types.ts`; `median`, `zonedParts` from `timing.ts`.
- Produces:
  - `buildWeek(i: { slots: ResolvedSlot[]; dayRanking: number[]; lanes: { new_page: Candidate[]; recycle: Candidate[]; promo: Candidate[]; filler: Candidate[] }; recycleCap: number; skipped: Set<string>; existingCandidateIds: Set<string>; existingDates: Set<string> }): { picks: Pick[]; emptyDays: string[]; summary: Record<Lane | "slots", number> }`
  - `onThisDay(i: { history: HistoryRow[]; date: string; tz: string; years?: number }): { row: HistoryRow; ratio: number | null; label: string }[]`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/plan/build.test.ts
import { describe, it, expect } from "vitest";
import { buildWeek, onThisDay } from "./build";
import type { Candidate, HistoryRow, ResolvedSlot } from "./types";

const slot = (date: string, dow: number, platform: ResolvedSlot["platform"]): ResolvedSlot => ({ date, dow, platform, at: `${date}T22:30:00.000Z`, low_sample: false });
const week = [
  slot("2026-09-14", 1, "facebook"), slot("2026-09-14", 1, "instagram"),
  slot("2026-09-16", 3, "facebook"), slot("2026-09-16", 3, "instagram"),
  slot("2026-09-18", 5, "facebook"),
];
const cand = (id: string, lane: Candidate["lane"]): Candidate => ({ id, lane, reason: "r", title: id, media: [] });
const lanes = (o: Partial<Record<Candidate["lane"], Candidate[]>>) => ({ new_page: [], recycle: [], promo: [], filler: [], ...o });

describe("buildWeek", () => {
  it("fills days in ranking order, lanes in priority order, pairing FB+IG slots on a day", () => {
    const r = buildWeek({ slots: week, dayRanking: [3, 1, 5], lanes: lanes({ new_page: [cand("project:n1", "new_page")], recycle: [cand("history:r1", "recycle")], filler: [cand("project:f1", "filler"), cand("project:f2", "filler")] }), recycleCap: 3, skipped: new Set(), existingCandidateIds: new Set(), existingDates: new Set() });
    expect(r.picks.map((p) => [p.date, p.candidate.id])).toEqual([["2026-09-16", "project:n1"], ["2026-09-14", "history:r1"], ["2026-09-18", "project:f1"]]);
    expect(r.picks[0].slots.map((s) => s.platform)).toEqual(["facebook", "instagram"]);
    expect(r.picks[2].slots).toHaveLength(1);
    expect(r.emptyDays).toEqual([]);
    expect(r.summary).toEqual({ new_page: 1, recycle: 1, promo: 0, filler: 1, slots: 3 });
  });
  it("caps recycles, honours skipped and existing candidates, reports empty days", () => {
    const r = buildWeek({ slots: week, dayRanking: [1, 3, 5], lanes: lanes({ recycle: [cand("history:a", "recycle"), cand("history:b", "recycle"), cand("history:c", "recycle")], filler: [cand("project:x", "filler")] }), recycleCap: 1, skipped: new Set(["history:a"]), existingCandidateIds: new Set(["project:x"]), existingDates: new Set() });
    expect(r.picks.map((p) => p.candidate.id)).toEqual(["history:b"]);
    expect(r.emptyDays).toEqual(["2026-09-16", "2026-09-18"]);
  });
  it("leaves days that already have a planned post alone", () => {
    const r = buildWeek({ slots: week, dayRanking: [1, 3, 5], lanes: lanes({ filler: [cand("project:1", "filler"), cand("project:2", "filler"), cand("project:3", "filler")] }), recycleCap: 3, skipped: new Set(), existingCandidateIds: new Set(), existingDates: new Set(["2026-09-14"]) });
    expect(r.picks.map((p) => p.date)).toEqual(["2026-09-16", "2026-09-18"]);
  });
  it("is deterministic", () => {
    const args = { slots: week, dayRanking: [1, 3, 5], lanes: lanes({ filler: [cand("project:1", "filler"), cand("project:2", "filler")] }), recycleCap: 3, skipped: new Set<string>(), existingCandidateIds: new Set<string>(), existingDates: new Set<string>() };
    expect(buildWeek(args)).toEqual(buildWeek(args));
  });
});

describe("onThisDay", () => {
  const h = (id: string, published_at: string, interactions: number, platform: HistoryRow["platform"] = "facebook"): HistoryRow => ({ id, brand_id: "b", platform, external_id: id, published_at, caption: id, media: [], permalink: null, likes: interactions, comments: 0, shares: 0, reach: null, interactions, post_id: null });
  it("returns rows within ±1 calendar day in earlier years with a ratio against the platform median", () => {
    const history = [h("a", "2025-09-14T20:00:00Z", 40), h("b", "2025-09-15T20:00:00Z", 10), h("c", "2024-09-13T20:00:00Z", 20), h("far", "2025-09-20T20:00:00Z", 99), h("thisyear", "2026-09-14T20:00:00Z", 5), h("base", "2025-01-01T20:00:00Z", 20)];
    const out = onThisDay({ history, date: "2026-09-14", tz: "America/Los_Angeles", years: 3 });
    expect(out.map((o) => o.row.id)).toEqual(["a", "b", "c"]);
    expect(out[0].ratio).toBe(2); // median of [40,10,20,99,5,20] = 20
    expect(out[0].label).toBe("Well above normal · 40 · 2.0x the usual");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/plan/build.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/plan/build.ts
import { median, zonedParts } from "./timing";
import type { Candidate, HistoryRow, Lane, Pick, ResolvedSlot } from "./types";

const LANE_ORDER: Lane[] = ["new_page", "recycle", "promo", "filler"];

export function buildWeek(i: {
  slots: ResolvedSlot[];
  dayRanking: number[];
  lanes: Record<Lane, Candidate[]>;
  recycleCap: number;
  skipped: Set<string>;
  existingCandidateIds: Set<string>;
  existingDates: Set<string>;
}): { picks: Pick[]; emptyDays: string[]; summary: Record<Lane | "slots", number> } {
  const byDate = new Map<string, ResolvedSlot[]>();
  for (const s of i.slots) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const dateForDow = (dow: number) => [...byDate.keys()].find((d) => byDate.get(d)![0].dow === dow);
  const days = i.dayRanking.map(dateForDow).filter((d): d is string => Boolean(d) && !i.existingDates.has(d!));

  const used = new Set<string>([...i.skipped, ...i.existingCandidateIds]);
  const queues: Record<Lane, Candidate[]> = { new_page: [...i.lanes.new_page], recycle: [...i.lanes.recycle], promo: [...i.lanes.promo], filler: [...i.lanes.filler] };
  const summary: Record<Lane | "slots", number> = { new_page: 0, recycle: 0, promo: 0, filler: 0, slots: 0 };
  const picks: Pick[] = [];
  const emptyDays: string[] = [];

  const next = (lane: Lane): Candidate | undefined => {
    if (lane === "recycle" && summary.recycle >= i.recycleCap) return undefined;
    while (queues[lane].length) {
      const c = queues[lane].shift()!;
      if (!used.has(c.id)) return c;
    }
    return undefined;
  };

  for (const date of days) {
    let picked: Candidate | undefined;
    for (const lane of LANE_ORDER) {
      picked = next(lane);
      if (picked) break;
    }
    if (!picked) { emptyDays.push(date); continue; }
    used.add(picked.id);
    summary[picked.lane]++;
    summary.slots++;
    picks.push({ date, slots: [...byDate.get(date)!].sort((a, b) => a.at.localeCompare(b.at)), candidate: picked });
  }
  return { picks, emptyDays: emptyDays.sort(), summary };
}

const ratioLabel = (ratio: number | null) => (ratio === null ? "No baseline" : ratio >= 1.5 ? "Well above normal" : ratio >= 0.8 ? "About normal" : "Below normal");

/** History rows on the same calendar day (±1) in previous years, with interactions vs the platform's median. */
export function onThisDay(i: { history: HistoryRow[]; date: string; tz: string; years?: number }): { row: HistoryRow; ratio: number | null; label: string }[] {
  const years = i.years ?? 3;
  const [y, m, d] = i.date.split("-").map(Number);
  const target = Date.UTC(2000, m - 1, d); // year-agnostic day-of-year comparison
  const medians = new Map<string, number>();
  for (const p of ["facebook", "instagram"]) medians.set(p, median(i.history.filter((h) => h.platform === p).map((h) => h.interactions)));
  return i.history
    .map((row) => ({ row, local: zonedParts(row.published_at, i.tz).date }))
    .filter(({ local }) => {
      const [ly, lm, ld] = local.split("-").map(Number);
      if (ly >= y || ly < y - years) return false;
      const diff = Math.abs(Date.UTC(2000, lm - 1, ld) - target) / 86_400_000;
      return diff <= 1 || diff >= 365; // handles Dec 31 / Jan 1 wrap
    })
    .sort((a, b) => b.local.localeCompare(a.local))
    .map(({ row }) => {
      const med = medians.get(row.platform) ?? 0;
      const ratio = med > 0 ? Math.round((row.interactions / med) * 10) / 10 : null;
      return { row, ratio, label: `${ratioLabel(ratio)} · ${row.interactions}${ratio !== null ? ` · ${ratio.toFixed(1)}x the usual` : ""}` };
    });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/plan/build.test.ts` — Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan/build.ts src/lib/plan/build.test.ts
git commit -m "feat(plan): buildWeek lane fill with recycle cap, onThisDay alternatives"
```

---

### Task 5: Meta history import (parsers + chunked importer)

**Files:**
- Create: `src/lib/meta/history.ts`
- Test: `src/lib/meta/history.test.ts`

**Interfaces:**
- Consumes: `graphFetch<T>(path, { token, params, fetchImpl })` from `@/lib/meta/graph`; `MetaConfig` (`page_id`, `ig_user_id?`) / `MetaSecret` (`page_access_token`) from `@/lib/connections/meta`.
- Produces:
  - `type HistoryInsert = { platform: "facebook" | "instagram"; external_id: string; published_at: string; caption: string; media: HistoryMedia[]; permalink: string | null; likes: number; comments: number; shares: number; reach: number | null }`
  - `parseFacebookPosts(payload: unknown): { rows: HistoryInsert[]; next: string | null }`
  - `parseInstagramMedia(payload: unknown): { rows: HistoryInsert[]; next: string | null }`
  - `fetchHistoryPage(i: { platform; token; pageId: string; igUserId?: string; cursorUrl: string | null; since?: string; fetchImpl? }): Promise<{ rows: HistoryInsert[]; next: string | null }>`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/meta/history.test.ts
import { describe, it, expect, vi } from "vitest";
import { parseFacebookPosts, parseInstagramMedia, fetchHistoryPage } from "./history";

const fb = {
  data: [
    { id: "1_1", message: "Hello", created_time: "2026-06-01T22:30:00+0000", permalink_url: "https://fb/1", attachments: { data: [{ media_type: "photo", media: { image: { src: "https://cdn/1.jpg" } } }] }, likes: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, shares: { count: 1 }, insights: { data: [{ name: "post_impressions_unique", values: [{ value: 900 }] }] } },
    { id: "1_2", created_time: "2026-05-30T22:30:00+0000", attachments: { data: [{ media_type: "album", subattachments: { data: [{ media: { image: { src: "https://cdn/a.jpg" } } }, { media: { image: { src: "https://cdn/b.jpg" } } }] } }] }, likes: { summary: { total_count: 0 } }, comments: { summary: { total_count: 0 } } },
    { id: "1_3", message: "Video", created_time: "2026-05-29T22:30:00+0000", attachments: { data: [{ media_type: "video", media: { image: { src: "https://cdn/thumb.jpg" } } }] } },
  ],
  paging: { next: "https://graph.facebook.com/v21.0/123/posts?after=abc" },
};
const ig = {
  data: [
    { id: "9", caption: "Shop", timestamp: "2026-06-01T22:30:00+0000", permalink: "https://ig/9", media_type: "IMAGE", media_url: "https://cdn/9.jpg", like_count: 7, comments_count: 2, insights: { data: [{ name: "reach", values: [{ value: 300 }] }] } },
    { id: "10", timestamp: "2026-05-30T22:30:00+0000", media_type: "CAROUSEL_ALBUM", media_url: "https://cdn/10.jpg", like_count: 1, comments_count: 0 },
    { id: "11", timestamp: "2026-05-29T22:30:00+0000", media_type: "VIDEO", thumbnail_url: "https://cdn/11.jpg", like_count: 4, comments_count: 1 },
  ],
};

describe("parseFacebookPosts", () => {
  it("maps photos, albums and videos with engagement and reach", () => {
    const { rows, next } = parseFacebookPosts(fb);
    expect(next).toBe("https://graph.facebook.com/v21.0/123/posts?after=abc");
    expect(rows[0]).toEqual({ platform: "facebook", external_id: "1_1", published_at: "2026-06-01T22:30:00.000Z", caption: "Hello", media: [{ url: "https://cdn/1.jpg", kind: "image" }], permalink: "https://fb/1", likes: 12, comments: 3, shares: 1, reach: 900 });
    expect(rows[1]).toMatchObject({ caption: "", media: [{ url: "https://cdn/a.jpg", kind: "carousel" }, { url: "https://cdn/b.jpg", kind: "carousel" }], likes: 0, shares: 0, reach: null });
    expect(rows[2]).toMatchObject({ media: [{ url: "https://cdn/thumb.jpg", kind: "video" }], likes: 0, comments: 0, reach: null });
  });
});

describe("parseInstagramMedia", () => {
  it("maps image, carousel and video with reach when present", () => {
    const { rows, next } = parseInstagramMedia(ig);
    expect(next).toBeNull();
    expect(rows[0]).toEqual({ platform: "instagram", external_id: "9", published_at: "2026-06-01T22:30:00.000Z", caption: "Shop", media: [{ url: "https://cdn/9.jpg", kind: "image" }], permalink: "https://ig/9", likes: 7, comments: 2, shares: 0, reach: 300 });
    expect(rows[1]).toMatchObject({ media: [{ url: "https://cdn/10.jpg", kind: "carousel" }], reach: null });
    expect(rows[2]).toMatchObject({ media: [{ url: "https://cdn/11.jpg", kind: "video" }] });
  });
});

describe("fetchHistoryPage", () => {
  it("calls the posts edge with fields on the first page and follows the cursor url verbatim after", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(fb), { status: 200, headers: { "content-type": "application/json" } }));
    const first = await fetchHistoryPage({ platform: "facebook", token: "T", pageId: "123", cursorUrl: null, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(first.rows).toHaveLength(3);
    const u1 = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(u1.pathname).toBe("/v21.0/123/posts");
    expect(u1.searchParams.get("fields")).toContain("attachments");
    expect(u1.searchParams.get("limit")).toBe("25");
    await fetchHistoryPage({ platform: "facebook", token: "T", pageId: "123", cursorUrl: first.next, fetchImpl: fetchImpl as unknown as typeof fetch });
    const u2 = new URL(String((fetchImpl.mock.calls[1] as unknown[])[0]));
    expect(u2.searchParams.get("after")).toBe("abc");
    expect(u2.searchParams.get("access_token")).toBe("T");
  });
  it("adds since for top-ups and uses the IG media edge", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(ig), { status: 200, headers: { "content-type": "application/json" } }));
    await fetchHistoryPage({ platform: "instagram", token: "T", pageId: "123", igUserId: "77", cursorUrl: null, since: "2026-08-15", fetchImpl: fetchImpl as unknown as typeof fetch });
    const u = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(u.pathname).toBe("/v21.0/77/media");
    expect(u.searchParams.get("since")).toBe("2026-08-15");
  });
  it("throws when instagram is requested without an IG user id", async () => {
    await expect(fetchHistoryPage({ platform: "instagram", token: "T", pageId: "123", cursorUrl: null })).rejects.toThrow(/Instagram/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/meta/history.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/meta/history.ts
import { graphFetch, GRAPH } from "./graph";
import { fetchWithTimeout } from "@/lib/connections/http";
import type { HistoryMedia } from "@/lib/plan/types";

export type HistoryInsert = {
  platform: "facebook" | "instagram";
  external_id: string;
  published_at: string;
  caption: string;
  media: HistoryMedia[];
  permalink: string | null;
  likes: number;
  comments: number;
  shares: number;
  reach: number | null;
};

const FB_FIELDS = "message,created_time,permalink_url,attachments{media_type,media,subattachments},likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions_unique)";
const IG_FIELDS = "caption,timestamp,permalink,media_type,media_url,thumbnail_url,like_count,comments_count,insights.metric(reach)";
export const PAGE_SIZE = 25;

type Paged<T> = { data?: T[]; paging?: { next?: string } };
type FbPost = {
  id: string; message?: string; created_time: string; permalink_url?: string;
  attachments?: { data?: { media_type?: string; media?: { image?: { src?: string } }; subattachments?: { data?: { media?: { image?: { src?: string } } }[] } }[] };
  likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number };
  insights?: { data?: { name: string; values?: { value?: number }[] }[] };
};
type IgMedia = { id: string; caption?: string; timestamp: string; permalink?: string; media_type?: string; media_url?: string; thumbnail_url?: string; like_count?: number; comments_count?: number; insights?: { data?: { name: string; values?: { value?: number }[] }[] } };

const iso = (s: string) => new Date(s).toISOString();
const metric = (ins: FbPost["insights"], name: string) => ins?.data?.find((d) => d.name === name)?.values?.[0]?.value ?? null;

export function parseFacebookPosts(payload: unknown): { rows: HistoryInsert[]; next: string | null } {
  const p = payload as Paged<FbPost>;
  const rows = (p.data ?? []).map((post): HistoryInsert => {
    const media: HistoryMedia[] = [];
    for (const a of post.attachments?.data ?? []) {
      const subs = a.subattachments?.data ?? [];
      if (subs.length) for (const s of subs) { const url = s.media?.image?.src; if (url) media.push({ url, kind: "carousel" }); }
      else { const url = a.media?.image?.src; if (url) media.push({ url, kind: a.media_type === "video" ? "video" : "image" }); }
    }
    return {
      platform: "facebook", external_id: post.id, published_at: iso(post.created_time), caption: post.message ?? "", media, permalink: post.permalink_url ?? null,
      likes: post.likes?.summary?.total_count ?? 0, comments: post.comments?.summary?.total_count ?? 0, shares: post.shares?.count ?? 0, reach: metric(post.insights, "post_impressions_unique"),
    };
  });
  return { rows, next: p.paging?.next ?? null };
}

export function parseInstagramMedia(payload: unknown): { rows: HistoryInsert[]; next: string | null } {
  const p = payload as Paged<IgMedia>;
  const rows = (p.data ?? []).map((m): HistoryInsert => {
    const kind: HistoryMedia["kind"] = m.media_type === "VIDEO" ? "video" : m.media_type === "CAROUSEL_ALBUM" ? "carousel" : "image";
    const url = kind === "video" ? (m.thumbnail_url ?? m.media_url) : m.media_url;
    return {
      platform: "instagram", external_id: m.id, published_at: iso(m.timestamp), caption: m.caption ?? "", media: url ? [{ url, kind }] : [], permalink: m.permalink ?? null,
      likes: m.like_count ?? 0, comments: m.comments_count ?? 0, shares: 0, reach: metric(m.insights, "reach"),
    };
  });
  return { rows, next: p.paging?.next ?? null };
}

/** One page of history. cursorUrl (Graph's paging.next) is followed verbatim; the first page is built from the edge + fields. */
export async function fetchHistoryPage(i: { platform: "facebook" | "instagram"; token: string; pageId: string; igUserId?: string; cursorUrl: string | null; since?: string; fetchImpl?: typeof fetch }): Promise<{ rows: HistoryInsert[]; next: string | null }> {
  const fetchImpl = i.fetchImpl ?? fetch;
  let payload: unknown;
  if (i.cursorUrl) {
    const u = new URL(i.cursorUrl);
    u.searchParams.set("access_token", i.token);
    const res = await fetchWithTimeout(u, {}, 20_000, fetchImpl);
    payload = await res.json();
    if (!res.ok) throw new Error(`Meta history page failed (${res.status})`);
  } else if (i.platform === "facebook") {
    payload = await graphFetch(`/${i.pageId}/posts`, { token: i.token, params: { fields: FB_FIELDS, limit: String(PAGE_SIZE), ...(i.since ? { since: i.since } : {}) }, fetchImpl });
  } else {
    if (!i.igUserId) throw new Error("Instagram account is not linked to this Page");
    payload = await graphFetch(`/${i.igUserId}/media`, { token: i.token, params: { fields: IG_FIELDS, limit: String(PAGE_SIZE), ...(i.since ? { since: i.since } : {}) }, fetchImpl });
  }
  return i.platform === "facebook" ? parseFacebookPosts(payload) : parseInstagramMedia(payload);
}
void GRAPH;
```

(Remove the trailing `void GRAPH;` and the `GRAPH` import if eslint flags it — it's only there so the import list matches the test's URL expectations; `graphFetch` already builds on `GRAPH`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/meta/history.test.ts` — Expected: PASS (6). If the IG insights test hits `insights.metric(reach)` errors on carousels in real use, that's handled by `metric()` returning null; no change needed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/history.ts src/lib/meta/history.test.ts
git commit -m "feat(meta): history parsers and paginated fetch for FB posts / IG media"
```

---

### Task 6: `PlanStore` interface, Supabase implementation, in-memory fake

**Files:**
- Create: `src/lib/plan/store.ts`
- Create: `src/lib/plan/fake-store.ts`
- Test: `src/lib/plan/fake-store.test.ts` (sanity for the fake only)

**Interfaces:**
- Consumes: `createAdminSupabase()` from `@/lib/supabase/admin`; `getDefaultRunner()` from `@/lib/settings/queries`; `HistoryInsert` from `@/lib/meta/history`; types from `./types`.
- Produces the `PlanStore` interface below. All later tasks call only these methods.

- [ ] **Step 1: Write the interface and Supabase implementation**

```ts
// src/lib/plan/store.ts
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getDefaultRunner } from "@/lib/settings/queries";
import type { Json } from "@/lib/database.types";
import type { HistoryInsert } from "@/lib/meta/history";
import type { ArticleLike, BrandSchedule, HistoryRow, Lane, PlanMeta, ProjectLike, ScheduleSlot } from "./types";

export type PlannedPost = {
  id: string; brand_id: string; title: string; status: string; project_id: string | null; recycled_from: string | null; plan: PlanMeta;
  targets: { platform: "facebook" | "instagram" | "gbp"; caption: string; scheduled_at: string | null; status: string }[];
};
export type PlanWeek = { brand_id: string; week_start: string; built_at: string; built_by: string; timing_source: string; skipped: string[]; summary: Record<Lane | "slots", number> };
export type BrandLite = { id: string; slug: string; name: string; timezone: string; active: boolean };

export type NewPlannedPost = {
  brand_id: string; title: string; link_url: string | null; media: { url: string; alt?: string }[]; source: "ai" | "recycled";
  status: "draft" | "pending_approval"; project_id: string | null; recycled_from: string | null; plan: PlanMeta; created_by: string | null;
  targets: { platform: "facebook" | "instagram"; caption: string; scheduled_at: string }[];
};

export interface PlanStore {
  listActiveBrands(): Promise<BrandLite[]>;
  getBrand(brandId: string): Promise<BrandLite | null>;
  getSchedule(brandId: string): Promise<BrandSchedule | null>;
  saveSchedule(brandId: string, patch: { slots?: ScheduleSlot[]; recycle_cap?: number; rest_days_min?: number; rest_days_max?: number }): Promise<void>;
  listHistory(brandId: string): Promise<HistoryRow[]>;
  upsertHistory(brandId: string, rows: HistoryInsert[], postId?: string | null): Promise<number>;
  getHistoryCursor(brandId: string): Promise<Record<string, string | null>>;
  setHistoryCursor(brandId: string, cursor: Record<string, string | null>, synced: boolean): Promise<void>;
  listProjects(brandId: string): Promise<ProjectLike[]>;
  listPublishedArticles(brandId: string): Promise<ArticleLike[]>;
  /** project ids referenced by any non-archived post; history ids / recycled_from used by posts in the last 180 days; article ids with a promo post; states used in the last 4 weeks. */
  listUsage(brandId: string, now: Date): Promise<{ postedProjectIds: Set<string>; pinnedProjectIds: Set<string>; recycledHistoryIds: Set<string>; promoedArticleIds: Set<string>; recentStates: string[] }>;
  favourCategory(brandId: string): Promise<string | null>;
  listPlannedPosts(brandId: string, weekStart: string): Promise<PlannedPost[]>;
  getPlannedPost(postId: string): Promise<PlannedPost | null>;
  createPlannedPost(input: NewPlannedPost): Promise<string>;
  /** Archives the post and cancels its queued jobs. */
  discardPlannedPost(postId: string): Promise<void>;
  markTouched(postId: string): Promise<void>;
  enqueueJob(brandId: string, type: "caption" | "promo", input: Record<string, unknown>, postId: string | null, articleId: string | null): Promise<string>;
  getPlanWeek(brandId: string, weekStart: string): Promise<PlanWeek | null>;
  upsertPlanWeek(week: Omit<PlanWeek, "built_at">): Promise<void>;
  addSkipped(brandId: string, weekStart: string, candidateId: string): Promise<void>;
  listPlanWeeks(brandId: string): Promise<string[]>;
}

const fail = (e: { message: string }): never => { throw new Error(e.message); };

export function createSupabasePlanStore(): PlanStore {
  const admin = createAdminSupabase();
  const mapPost = (p: Record<string, unknown>): PlannedPost => ({
    id: p.id as string, brand_id: p.brand_id as string, title: p.title as string, status: p.status as string, project_id: (p.project_id as string | null) ?? null, recycled_from: (p.recycled_from as string | null) ?? null,
    plan: p.plan as PlanMeta, targets: ((p.targets as PlannedPost["targets"]) ?? []).map((t) => ({ platform: t.platform, caption: t.caption, scheduled_at: t.scheduled_at, status: t.status })),
  });
  return {
    async listActiveBrands() {
      const { data, error } = await admin.from("brands").select("id,slug,name,timezone,active").eq("active", true);
      if (error) fail(error);
      return data ?? [];
    },
    async getBrand(brandId) {
      const { data } = await admin.from("brands").select("id,slug,name,timezone,active").eq("id", brandId).maybeSingle();
      return data ?? null;
    },
    async getSchedule(brandId) {
      const { data } = await admin.from("brand_schedules").select("*").eq("brand_id", brandId).maybeSingle();
      if (!data) return null;
      return { brand_id: data.brand_id, slots: (data.slots as ScheduleSlot[]) ?? [], recycle_cap: data.recycle_cap, rest_days_min: data.rest_days_min, rest_days_max: data.rest_days_max, history_synced_at: data.history_synced_at };
    },
    async saveSchedule(brandId, patch) {
      const { error } = await admin.from("brand_schedules").upsert({ brand_id: brandId, ...(patch.slots ? { slots: patch.slots as unknown as Json } : {}), ...(patch.recycle_cap !== undefined ? { recycle_cap: patch.recycle_cap } : {}), ...(patch.rest_days_min !== undefined ? { rest_days_min: patch.rest_days_min } : {}), ...(patch.rest_days_max !== undefined ? { rest_days_max: patch.rest_days_max } : {}), updated_at: new Date().toISOString() }, { onConflict: "brand_id" });
      if (error) fail(error);
    },
    async listHistory(brandId) {
      const { data, error } = await admin.from("social_history").select("*").eq("brand_id", brandId).order("published_at", { ascending: false }).limit(5000);
      if (error) fail(error);
      return (data ?? []).map((h) => ({ ...h, platform: h.platform as "facebook" | "instagram", media: (h.media as HistoryRow["media"]) ?? [] }));
    },
    async upsertHistory(brandId, rows, postId = null) {
      if (rows.length === 0) return 0;
      const { error } = await admin.from("social_history").upsert(rows.map((r) => ({ brand_id: brandId, ...r, media: r.media as unknown as Json, post_id: postId, fetched_at: new Date().toISOString() })), { onConflict: "brand_id,platform,external_id" });
      if (error) fail(error);
      return rows.length;
    },
    async getHistoryCursor(brandId) {
      const { data } = await admin.from("brand_schedules").select("history_cursor").eq("brand_id", brandId).maybeSingle();
      return ((data?.history_cursor as Record<string, string | null>) ?? {});
    },
    async setHistoryCursor(brandId, cursor, synced) {
      const { error } = await admin.from("brand_schedules").upsert({ brand_id: brandId, history_cursor: cursor as Json, ...(synced ? { history_synced_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() }, { onConflict: "brand_id" });
      if (error) fail(error);
    },
    async listProjects(brandId) {
      const { data, error } = await admin.from("projects").select("id,title,url,category,state,images,imported_at").eq("brand_id", brandId);
      if (error) fail(error);
      return (data ?? []).map((p) => ({ ...p, images: (p.images as ProjectLike["images"]) ?? [] }));
    },
    async listPublishedArticles(brandId) {
      const { data, error } = await admin.from("articles").select("id,title,published_at").eq("brand_id", brandId).eq("status", "published");
      if (error) fail(error);
      return (data ?? []) as ArticleLike[];
    },
    async listUsage(brandId, now) {
      const since180 = new Date(now.getTime() - 180 * 86_400_000).toISOString();
      const since90 = new Date(now.getTime() - 90 * 86_400_000).toISOString();
      const since28 = new Date(now.getTime() - 28 * 86_400_000).toISOString();
      const [{ data: posts }, { data: pins }, { data: recentPosts }] = await Promise.all([
        admin.from("posts").select("project_id,recycled_from,plan,created_at").eq("brand_id", brandId).neq("status", "archived"),
        admin.from("pins").select("project_id").eq("brand_id", brandId).neq("status", "archived").gte("created_at", since90),
        admin.from("posts").select("project:projects(state)").eq("brand_id", brandId).neq("status", "archived").gte("created_at", since28).not("project_id", "is", null),
      ]);
      const postedProjectIds = new Set<string>(), recycledHistoryIds = new Set<string>(), promoedArticleIds = new Set<string>();
      for (const p of posts ?? []) {
        if (p.project_id) postedProjectIds.add(p.project_id);
        const plan = p.plan as PlanMeta | null;
        if (plan?.lane === "recycle" && p.created_at >= since180) recycledHistoryIds.add(plan.candidate_id.replace(/^history:/, ""));
        if (plan?.lane === "promo") promoedArticleIds.add(plan.candidate_id.replace(/^article:/, ""));
      }
      const pinnedProjectIds = new Set((pins ?? []).map((p) => p.project_id).filter((x): x is string => Boolean(x)));
      const recentStates = [...new Set((recentPosts ?? []).map((r) => (r.project as unknown as { state: string | null } | null)?.state).filter((s): s is string => Boolean(s)))];
      return { postedProjectIds, pinnedProjectIds, recycledHistoryIds, promoedArticleIds, recentStates };
    },
    async favourCategory(brandId) {
      const [{ data: cats }, { data: recent }] = await Promise.all([
        admin.from("post_categories").select("id,name,slug,target_share,description,sort_order").eq("brand_id", brandId).order("sort_order"),
        admin.from("posts").select("category_id").eq("brand_id", brandId).in("status", ["approved", "published"]).order("created_at", { ascending: false }).limit(20),
      ]);
      if (!cats?.length) return null;
      const { computeContentMix } = await import("@/lib/ai/content-mix");
      const mix = computeContentMix(cats.map((c) => ({ ...c, target_share: Number(c.target_share) })), recent ?? []);
      return cats.find((c) => c.slug === mix.favour_next)?.name ?? null;
    },
    async listPlannedPosts(brandId, weekStart) {
      const { data, error } = await admin.from("posts").select("id,brand_id,title,status,project_id,recycled_from,plan,targets:post_targets(platform,caption,scheduled_at,status)").eq("brand_id", brandId).neq("status", "archived").contains("plan", { week_start: weekStart });
      if (error) fail(error);
      return (data ?? []).map((p) => mapPost(p as unknown as Record<string, unknown>));
    },
    async getPlannedPost(postId) {
      const { data } = await admin.from("posts").select("id,brand_id,title,status,project_id,recycled_from,plan,targets:post_targets(platform,caption,scheduled_at,status)").eq("id", postId).not("plan", "is", null).maybeSingle();
      return data ? mapPost(data as unknown as Record<string, unknown>) : null;
    },
    async createPlannedPost(input) {
      const { data, error } = await admin.from("posts").insert({
        brand_id: input.brand_id, title: input.title, link_url: input.link_url, media: input.media as unknown as Json, source: input.source, status: input.status,
        project_id: input.project_id, recycled_from: input.recycled_from, plan: input.plan as unknown as Json, created_by: input.created_by,
      }).select("id").single();
      if (error || !data) fail(error ?? { message: "insert failed" });
      const { error: te } = await admin.from("post_targets").insert(input.targets.map((t) => ({ post_id: data!.id, platform: t.platform, caption: t.caption, scheduled_at: t.scheduled_at })));
      if (te) fail(te);
      return data!.id;
    },
    async discardPlannedPost(postId) {
      await admin.from("generation_jobs").update({ status: "failed", error: "Cancelled: plan rebuilt" }).eq("post_id", postId).in("status", ["queued", "claimed"]);
      const { error } = await admin.from("posts").update({ status: "archived" }).eq("id", postId);
      if (error) fail(error);
    },
    async markTouched(postId) {
      const { data } = await admin.from("posts").select("plan").eq("id", postId).maybeSingle();
      const plan = data?.plan as PlanMeta | null;
      if (!plan || plan.touched) return;
      await admin.from("posts").update({ plan: { ...plan, touched: true } as unknown as Json }).eq("id", postId);
    },
    async enqueueJob(brandId, type, input, postId, articleId) {
      const runner = await getDefaultRunner();
      const { data, error } = await admin.from("generation_jobs").insert({ brand_id: brandId, type, input: input as Json, runner, post_id: postId, article_id: articleId }).select("id").single();
      if (error || !data) fail(error ?? { message: "job insert failed" });
      return data!.id;
    },
    async getPlanWeek(brandId, weekStart) {
      const { data } = await admin.from("plan_weeks").select("*").eq("brand_id", brandId).eq("week_start", weekStart).maybeSingle();
      return data ? { ...data, skipped: (data.skipped as string[]) ?? [], summary: data.summary as PlanWeek["summary"] } : null;
    },
    async upsertPlanWeek(week) {
      const { error } = await admin.from("plan_weeks").upsert({ ...week, skipped: week.skipped as unknown as Json, summary: week.summary as unknown as Json, built_at: new Date().toISOString() }, { onConflict: "brand_id,week_start" });
      if (error) fail(error);
    },
    async addSkipped(brandId, weekStart, candidateId) {
      const cur = await this.getPlanWeek(brandId, weekStart);
      if (!cur) return;
      await admin.from("plan_weeks").update({ skipped: [...new Set([...cur.skipped, candidateId])] as unknown as Json }).eq("brand_id", brandId).eq("week_start", weekStart);
    },
    async listPlanWeeks(brandId) {
      const { data } = await admin.from("plan_weeks").select("week_start").eq("brand_id", brandId).order("week_start", { ascending: false });
      return (data ?? []).map((w) => w.week_start);
    },
  };
}
```

Note: `getDefaultRunner()` — check its return type in `src/lib/settings/queries.ts`; if it returns `RunnerSetting` that isn't exactly `"in_app" | "mcp"`, map it the same way `src/lib/jobs/actions.ts` does. In-app-runner jobs created here are picked up by the existing `/api/cron/jobs` backstop (queued > 60 s), so no `after(runJob)` is needed.

- [ ] **Step 2: Write the fake store and its sanity test**

```ts
// src/lib/plan/fake-store.ts
import type { PlanStore, PlannedPost, PlanWeek, NewPlannedPost, BrandLite } from "./store";
import type { ArticleLike, BrandSchedule, HistoryRow, ProjectLike } from "./types";
import type { HistoryInsert } from "@/lib/meta/history";

export const BRAND: BrandLite = { id: "b1", slug: "acme", name: "Acme", timezone: "America/Los_Angeles", active: true };

export type FakePlanStore = PlanStore & {
  posts: (PlannedPost & { media: unknown; source: string; created_by: string | null })[];
  jobs: { id: string; type: string; input: Record<string, unknown>; post_id: string | null; article_id: string | null; status: string }[];
  weeks: PlanWeek[];
  history: HistoryRow[];
  cursor: Record<string, string | null>;
  schedule: BrandSchedule | null;
};

export function fakePlanStore(seed: { schedule?: BrandSchedule | null; history?: HistoryRow[]; projects?: ProjectLike[]; articles?: ArticleLike[]; usage?: Partial<Awaited<ReturnType<PlanStore["listUsage"]>>>; favourCategory?: string | null } = {}): FakePlanStore {
  let n = 0;
  const store: FakePlanStore = {
    posts: [], jobs: [], weeks: [], history: seed.history ?? [], cursor: {}, schedule: seed.schedule ?? null,
    async listActiveBrands() { return [BRAND]; },
    async getBrand(id) { return id === BRAND.id ? BRAND : null; },
    async getSchedule() { return store.schedule; },
    async saveSchedule(brandId, patch) { store.schedule = { brand_id: brandId, slots: [], recycle_cap: 3, rest_days_min: 60, rest_days_max: 90, history_synced_at: null, ...store.schedule, ...patch }; },
    async listHistory() { return store.history; },
    async upsertHistory(brandId, rows: HistoryInsert[], postId = null) {
      for (const r of rows) {
        const idx = store.history.findIndex((h) => h.platform === r.platform && h.external_id === r.external_id);
        const row: HistoryRow = { id: idx >= 0 ? store.history[idx].id : `h${++n}`, brand_id: brandId, ...r, interactions: r.likes + r.comments + r.shares, post_id: postId };
        if (idx >= 0) store.history[idx] = row; else store.history.push(row);
      }
      return rows.length;
    },
    async getHistoryCursor() { return store.cursor; },
    async setHistoryCursor(_b, cursor, synced) { store.cursor = cursor; if (synced && store.schedule) store.schedule.history_synced_at = new Date().toISOString(); },
    async listProjects() { return seed.projects ?? []; },
    async listPublishedArticles() { return seed.articles ?? []; },
    async listUsage() { return { postedProjectIds: new Set(), pinnedProjectIds: new Set(), recycledHistoryIds: new Set(), promoedArticleIds: new Set(), recentStates: [], ...seed.usage }; },
    async favourCategory() { return seed.favourCategory ?? null; },
    async listPlannedPosts(_b, weekStart) { return store.posts.filter((p) => p.status !== "archived" && p.plan.week_start === weekStart); },
    async getPlannedPost(id) { return store.posts.find((p) => p.id === id) ?? null; },
    async createPlannedPost(input: NewPlannedPost) {
      const id = `p${++n}`;
      store.posts.push({ id, brand_id: input.brand_id, title: input.title, status: input.status, project_id: input.project_id, recycled_from: input.recycled_from, plan: input.plan, media: input.media, source: input.source, created_by: input.created_by, targets: input.targets.map((t) => ({ ...t, status: "pending" })) });
      return id;
    },
    async discardPlannedPost(id) {
      const p = store.posts.find((x) => x.id === id);
      if (p) p.status = "archived";
      for (const j of store.jobs) if (j.post_id === id && j.status === "queued") j.status = "failed";
    },
    async markTouched(id) { const p = store.posts.find((x) => x.id === id); if (p) p.plan = { ...p.plan, touched: true }; },
    async enqueueJob(_b, type, input, post_id, article_id) { const id = `j${++n}`; store.jobs.push({ id, type, input, post_id, article_id, status: "queued" }); return id; },
    async getPlanWeek(_b, weekStart) { return store.weeks.find((w) => w.week_start === weekStart) ?? null; },
    async upsertPlanWeek(week) {
      const idx = store.weeks.findIndex((w) => w.week_start === week.week_start);
      const row = { ...week, built_at: new Date().toISOString() };
      if (idx >= 0) store.weeks[idx] = row; else store.weeks.push(row);
    },
    async addSkipped(_b, weekStart, id) { const w = store.weeks.find((x) => x.week_start === weekStart); if (w && !w.skipped.includes(id)) w.skipped.push(id); },
    async listPlanWeeks() { return store.weeks.map((w) => w.week_start).sort().reverse(); },
  };
  return store;
}
```

```ts
// src/lib/plan/fake-store.test.ts
import { describe, it, expect } from "vitest";
import { fakePlanStore } from "./fake-store";

describe("fakePlanStore", () => {
  it("upserts history by platform+external_id and computes interactions", async () => {
    const s = fakePlanStore();
    await s.upsertHistory("b1", [{ platform: "facebook", external_id: "1", published_at: "2026-01-01T00:00:00Z", caption: "", media: [], permalink: null, likes: 1, comments: 2, shares: 3, reach: null }]);
    await s.upsertHistory("b1", [{ platform: "facebook", external_id: "1", published_at: "2026-01-01T00:00:00Z", caption: "", media: [], permalink: null, likes: 5, comments: 0, shares: 0, reach: 10 }]);
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toMatchObject({ interactions: 5, reach: 10 });
  });
});
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npx vitest run src/lib/plan/fake-store.test.ts && npx tsc --noEmit -p .` — Expected: PASS; tsc clean (fix any Supabase typing complaints by casting through `unknown` as the existing `store.ts` does).

- [ ] **Step 4: Commit**

```bash
git add src/lib/plan/store.ts src/lib/plan/fake-store.ts src/lib/plan/fake-store.test.ts
git commit -m "feat(plan): PlanStore interface with Supabase and in-memory implementations"
```

---

### Task 7: Materialisation core — `planWeek`, `materialiseWeek`, `rebuildWeek`, `useInstead`

**Files:**
- Create: `src/lib/plan/materialise.ts`
- Test: `src/lib/plan/materialise.test.ts`

**Interfaces:**
- Consumes: `PlanStore`; `resolveSlots`; the four lane functions; `buildWeek`; types.
- Produces:
  - `weekStartFor(date: Date, tz: string): string` (brand-local Monday `YYYY-MM-DD`)
  - `planWeek(store, brandId, weekStart, now): Promise<{ picks; emptyDays; summary; timingSource; slots }>` (no writes)
  - `materialiseWeek(store, i: { brandId; weekStart; by: string; now?: Date }): Promise<{ created: number; emptyDays: string[]; summary }>`
  - `rebuildWeek(store, i: { brandId; weekStart; by: string; now?: Date }): Promise<{ removed: number; created: number }>`
  - `useInstead(store, i: { postId: string; historyId: string; by: string }): Promise<{ newPostId: string }>`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/plan/materialise.test.ts
import { describe, it, expect } from "vitest";
import { fakePlanStore, BRAND } from "./fake-store";
import { materialiseWeek, rebuildWeek, useInstead, weekStartFor } from "./materialise";
import type { BrandSchedule, HistoryRow, ProjectLike } from "./types";

const NOW = new Date("2026-09-10T12:00:00Z");
const schedule: BrandSchedule = { brand_id: "b1", recycle_cap: 1, rest_days_min: 60, rest_days_max: 90, history_synced_at: null, slots: [
  { dow: 1, platform: "facebook", time: "15:30" }, { dow: 1, platform: "instagram", time: "17:30" },
  { dow: 3, platform: "facebook", time: "15:30" }, { dow: 3, platform: "instagram", time: "17:30" },
  { dow: 5, platform: "facebook", time: "15:30" }, { dow: 5, platform: "instagram", time: "17:30" },
] };
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const proj = (id: string, o: Partial<ProjectLike> = {}): ProjectLike => ({ id, title: `Project ${id}`, url: `https://x/${id}`, category: "Shops", state: "WA", images: [{ url: `https://x/${id}.jpg`, alt: "a" }], imported_at: daysAgo(3), ...o });
const hist = (id: string, o: Partial<HistoryRow> = {}): HistoryRow => ({ id, brand_id: "b1", platform: "facebook", external_id: id, published_at: daysAgo(70), caption: `Caption ${id}\nmore`, media: [{ url: `https://x/${id}.jpg`, kind: "image" }], permalink: null, likes: 50, comments: 0, shares: 0, reach: null, interactions: 50, post_id: null, ...o });

describe("weekStartFor", () => {
  it("returns the brand-local Monday", () => {
    expect(weekStartFor(new Date("2026-09-14T03:00:00Z"), "America/Los_Angeles")).toBe("2026-09-08"); // still Sunday evening in LA
    expect(weekStartFor(new Date("2026-09-14T12:00:00Z"), "America/Los_Angeles")).toBe("2026-09-14");
  });
});

describe("materialiseWeek", () => {
  it("creates draft posts + caption jobs for projects, pending recycles with copied captions, and records the week", async () => {
    const store = fakePlanStore({ schedule, projects: [proj("n1")], history: [hist("r1"), hist("r2"), ...Array.from({ length: 6 }, (_, i) => hist(`low${i}`, { likes: 1, interactions: 1 }))] });
    const out = await materialiseWeek(store, { brandId: BRAND.id, weekStart: "2026-09-14", by: "cron", now: NOW });
    expect(out.created).toBe(2);
    expect(out.summary).toMatchObject({ new_page: 1, recycle: 1, filler: 0 });
    const draft = store.posts.find((p) => p.plan.lane === "new_page")!;
    expect(draft).toMatchObject({ status: "draft", project_id: "n1", source: "ai", title: "Project n1" });
    expect(draft.targets.map((t) => [t.platform, t.scheduled_at])).toEqual([["facebook", "2026-09-14T22:30:00.000Z"], ["instagram", "2026-09-15T00:30:00.000Z"]]);
    expect(store.jobs).toEqual([expect.objectContaining({ type: "caption", post_id: draft.id, input: { post_id: draft.id, plan: { lane: "new_page", reason: expect.any(String) } } })]);
    const recycle = store.posts.find((p) => p.plan.lane === "recycle")!;
    expect(recycle).toMatchObject({ status: "pending_approval", source: "recycled", title: "Re-run: Caption r1" });
    expect(recycle.targets.every((t) => t.caption === "Caption r1\nmore")).toBe(true);
    expect(store.weeks[0]).toMatchObject({ week_start: "2026-09-14", built_by: "cron", timing_source: "Brand schedule" });
    expect(out.emptyDays).toEqual(["2026-09-18"]);
  });
  it("never creates an approved or publishing post (approval guarantee)", async () => {
    const store = fakePlanStore({ schedule, projects: [proj("a"), proj("b"), proj("c")], history: [hist("r1")] });
    await materialiseWeek(store, { brandId: BRAND.id, weekStart: "2026-09-14", by: "u1", now: NOW });
    expect(store.posts.length).toBeGreaterThan(0);
    for (const p of store.posts) {
      expect(["draft", "pending_approval"]).toContain(p.status);
      expect(p.targets.every((t) => t.status === "pending")).toBe(true);
    }
  });
  it("queues a promo job instead of a post for a fresh article", async () => {
    const store = fakePlanStore({ schedule, articles: [{ id: "art1", title: "Guide", published_at: daysAgo(2) }] });
    const out = await materialiseWeek(store, { brandId: BRAND.id, weekStart: "2026-09-14", by: "u1", now: NOW });
    expect(out.summary.promo).toBe(1);
    expect(store.posts).toHaveLength(0);
    expect(store.jobs[0]).toMatchObject({ type: "promo", article_id: "art1", input: { article_id: "art1", scheduled_after: "2026-09-14T22:30:00.000Z", plan: { week_start: "2026-09-14", lane: "promo", candidate_id: "article:art1" } } });
  });
  it("is a no-op for a brand without a schedule", async () => {
    const store = fakePlanStore({ schedule: null, projects: [proj("n1")] });
    await expect(materialiseWeek(store, { brandId: BRAND.id, weekStart: "2026-09-14", by: "u1", now: NOW })).rejects.toThrow(/schedule/);
  });
});

describe("rebuildWeek", () => {
  it("removes untouched planned drafts (cancelling jobs), keeps touched ones, and does not re-offer skipped candidates", async () => {
    const store = fakePlanStore({ schedule, projects: [proj("a"), proj("b"), proj("c"), proj("d")] });
    await materialiseWeek(store, { brandId: BRAND.id, weekStart: "2026-09-14", by: "u1", now: NOW });
    const [first, second] = store.posts;
    await store.markTouched(second.id);
    await store.addSkipped(BRAND.id, "2026-09-14", first.plan.candidate_id);
    const r = await rebuildWeek(store, { brandId: BRAND.id, weekStart: "2026-09-14", by: "u1", now: NOW });
    expect(r.removed).toBe(2);
    expect(store.jobs.filter((j) => j.post_id === first.id).every((j) => j.status === "failed")).toBe(true);
    const live = store.posts.filter((p) => p.status !== "archived");
    expect(live.map((p) => p.plan.candidate_id)).not.toContain(first.plan.candidate_id);
    expect(live.some((p) => p.id === second.id)).toBe(true);
    expect(live).toHaveLength(3);
  });
});

describe("useInstead", () => {
  it("archives the post and materialises a recycle of the chosen history row into the same slots", async () => {
    const store = fakePlanStore({ schedule, projects: [proj("a")], history: [hist("alt", { published_at: "2025-09-14T22:00:00Z" })] });
    await materialiseWeek(store, { brandId: BRAND.id, weekStart: "2026-09-14", by: "u1", now: NOW });
    const original = store.posts[0];
    const { newPostId } = await useInstead(store, { postId: original.id, historyId: "alt", by: "u1" });
    expect(store.posts.find((p) => p.id === original.id)!.status).toBe("archived");
    const np = store.posts.find((p) => p.id === newPostId)!;
    expect(np).toMatchObject({ status: "pending_approval", source: "recycled", plan: { lane: "recycle", candidate_id: "history:alt", week_start: "2026-09-14" } });
    expect(np.targets.map((t) => t.scheduled_at)).toEqual(original.targets.map((t) => t.scheduled_at));
    expect(store.weeks[0].skipped).toContain(original.plan.candidate_id);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/plan/materialise.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/plan/materialise.ts
import { resolveSlots, zonedParts, addDays } from "./timing";
import { newPageCandidates, recyclePool, promoCandidates, fillerCandidates } from "./candidates";
import { buildWeek } from "./build";
import type { PlanStore, NewPlannedPost, PlannedPost } from "./store";
import type { Candidate, Lane, Pick, PlanMeta, ResolvedSlot, HistoryRow } from "./types";

/** Brand-local Monday (YYYY-MM-DD) of the week containing `date`. */
export function weekStartFor(date: Date, tz: string): string {
  const { dow, date: local } = zonedParts(date.toISOString(), tz);
  return addDays(local, -((dow + 6) % 7));
}

export async function planWeek(store: PlanStore, brandId: string, weekStart: string, now: Date) {
  const [brand, schedule] = await Promise.all([store.getBrand(brandId), store.getSchedule(brandId)]);
  if (!brand) throw new Error("Brand not found");
  if (!schedule || schedule.slots.length === 0) throw new Error("Set a posting schedule on the brand first");
  const [history, projects, articles, usage, favour, planWeekRow, existing] = await Promise.all([
    store.listHistory(brandId), store.listProjects(brandId), store.listPublishedArticles(brandId), store.listUsage(brandId, now), store.favourCategory(brandId), store.getPlanWeek(brandId, weekStart), store.listPlannedPosts(brandId, weekStart),
  ]);
  const timing = resolveSlots({ schedule, history, weekStart, tz: brand.timezone });
  const lanes: Record<Lane, Candidate[]> = {
    new_page: newPageCandidates({ projects, postedProjectIds: usage.postedProjectIds, weekStart }),
    recycle: recyclePool({ history, schedule, recycledHistoryIds: usage.recycledHistoryIds, now }),
    promo: promoCandidates({ articles, promoedArticleIds: usage.promoedArticleIds, now }),
    filler: fillerCandidates({ projects, postedProjectIds: usage.postedProjectIds, pinnedProjectIds: usage.pinnedProjectIds, favourCategory: favour, recentStates: usage.recentStates }),
  };
  const existingDates = new Set(existing.flatMap((p) => p.targets.map((t) => (t.scheduled_at ? zonedParts(t.scheduled_at, brand.timezone).date : ""))).filter(Boolean));
  const built = buildWeek({ slots: timing.slots, dayRanking: timing.dayRanking, lanes, recycleCap: schedule.recycle_cap, skipped: new Set(planWeekRow?.skipped ?? []), existingCandidateIds: new Set(existing.map((p) => p.plan.candidate_id)), existingDates });
  return { ...built, timingSource: timing.source, slots: timing.slots, brand, schedule, recyclePool: lanes.recycle };
}

const meta = (weekStart: string, c: Candidate): PlanMeta => ({ week_start: weekStart, lane: c.lane, reason: c.reason, candidate_id: c.id, touched: false });

function recyclePostInput(brandId: string, weekStart: string, c: Candidate, slots: ResolvedSlot[], by: string): NewPlannedPost {
  const h = c.history!;
  return {
    brand_id: brandId, title: `Re-run: ${c.title.replace(/^Re-run: /, "")}`, link_url: null, media: h.media.map((m) => ({ url: m.url })), source: "recycled", status: "pending_approval",
    project_id: null, recycled_from: h.post_id, plan: meta(weekStart, c), created_by: by === "cron" ? null : by,
    targets: slots.map((s) => ({ platform: s.platform, caption: h.caption, scheduled_at: s.at })),
  };
}

async function materialisePick(store: PlanStore, brandId: string, weekStart: string, pick: Pick, by: string): Promise<void> {
  const c = pick.candidate;
  if (c.lane === "promo") {
    await store.enqueueJob(brandId, "promo", { article_id: c.article!.id, scheduled_after: pick.slots[0].at, plan: meta(weekStart, c) }, null, c.article!.id);
    return;
  }
  if (c.lane === "recycle") {
    await store.createPlannedPost(recyclePostInput(brandId, weekStart, c, pick.slots, by));
    return;
  }
  const postId = await store.createPlannedPost({
    brand_id: brandId, title: c.title, link_url: c.project?.url ?? null, media: c.media, source: "ai", status: "draft", project_id: c.project?.id ?? null, recycled_from: null,
    plan: meta(weekStart, c), created_by: by === "cron" ? null : by, targets: pick.slots.map((s) => ({ platform: s.platform, caption: "", scheduled_at: s.at })),
  });
  await store.enqueueJob(brandId, "caption", { post_id: postId, plan: { lane: c.lane, reason: c.reason } }, postId, null);
}

export async function materialiseWeek(store: PlanStore, i: { brandId: string; weekStart: string; by: string; now?: Date }): Promise<{ created: number; emptyDays: string[]; summary: Record<Lane | "slots", number> }> {
  const now = i.now ?? new Date();
  const plan = await planWeek(store, i.brandId, i.weekStart, now);
  for (const pick of plan.picks) await materialisePick(store, i.brandId, i.weekStart, pick, i.by);
  const prior = await store.getPlanWeek(i.brandId, i.weekStart);
  await store.upsertPlanWeek({ brand_id: i.brandId, week_start: i.weekStart, built_by: i.by, timing_source: plan.timingSource, skipped: prior?.skipped ?? [], summary: plan.summary });
  return { created: plan.picks.length, emptyDays: plan.emptyDays, summary: plan.summary };
}

const isUntouched = (p: PlannedPost) => !p.plan.touched && (p.status === "draft" || p.status === "pending_approval");

export async function rebuildWeek(store: PlanStore, i: { brandId: string; weekStart: string; by: string; now?: Date }): Promise<{ removed: number; created: number }> {
  const existing = await store.listPlannedPosts(i.brandId, i.weekStart);
  let removed = 0;
  for (const p of existing) if (isUntouched(p)) { await store.discardPlannedPost(p.id); removed++; }
  const out = await materialiseWeek(store, i);
  return { removed, created: out.created };
}

export async function useInstead(store: PlanStore, i: { postId: string; historyId: string; by: string }): Promise<{ newPostId: string }> {
  const post = await store.getPlannedPost(i.postId);
  if (!post) throw new Error("Planned post not found");
  const history = await store.listHistory(post.brand_id);
  const h: HistoryRow | undefined = history.find((x) => x.id === i.historyId);
  if (!h) throw new Error("History post not found");
  const slots: ResolvedSlot[] = post.targets.filter((t) => t.scheduled_at && t.platform !== "gbp").map((t) => ({ date: post.plan.week_start, dow: 0, platform: t.platform as "facebook" | "instagram", at: t.scheduled_at!, low_sample: false }));
  const candidate: Candidate = { id: `history:${h.id}`, lane: "recycle", reason: `Chosen by hand from "on this day" (${h.published_at.slice(0, 10)}, ${h.interactions} interactions).`, title: h.caption.split("\n")[0].slice(0, 80) || "Re-run", media: h.media.map((m) => ({ url: m.url })), history: h };
  await store.discardPlannedPost(post.id);
  await store.addSkipped(post.brand_id, post.plan.week_start, post.plan.candidate_id);
  const newPostId = await store.createPlannedPost(recyclePostInput(post.brand_id, post.plan.week_start, candidate, slots, i.by));
  return { newPostId };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/plan` — Expected: all PASS. (If `emptyDays` differs, check `resolveSlots` day ranking for the schedule-only case: Mon, Wed, Fri order.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan/materialise.ts src/lib/plan/materialise.test.ts
git commit -m "feat(plan): plan → posts materialisation, rebuild, use-instead (never approves)"
```

---

### Task 8: History import orchestration + publish-time mirror + nightly top-up

**Files:**
- Create: `src/lib/plan/history-sync.ts`
- Test: `src/lib/plan/history-sync.test.ts`
- Modify: `src/lib/publishers/run.ts:46` and `:58` (mirror on publish)
- Modify: `src/app/api/cron/insights/route.ts` (nightly top-up)

**Interfaces:**
- Consumes: `fetchHistoryPage` (Task 5), `PlanStore.upsertHistory/getHistoryCursor/setHistoryCursor`, `getConnectionWithSecret<MetaConfig, MetaSecret>(brandId, "meta")` from `@/lib/connections/queries`.
- Produces:
  - `importHistoryChunk(store, i: { brandId; platform; since?: string; fetchImpl? }): Promise<{ imported: number; done: boolean }>`
  - `topUpHistoryForAllBrands(store): Promise<{ brands: number; imported: number }>`
  - `mirrorPublishedTarget(store, i: { brandId; postId; platform; externalId; externalUrl; caption; media; publishedAt }): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/plan/history-sync.test.ts
import { describe, it, expect, vi } from "vitest";
import { fakePlanStore, BRAND } from "./fake-store";
import { importHistoryChunk, mirrorPublishedTarget } from "./history-sync";

const page = (ids: string[], next: string | null) => ({ data: ids.map((id) => ({ id, message: id, created_time: "2026-06-01T22:30:00+0000", likes: { summary: { total_count: 1 } }, comments: { summary: { total_count: 0 } } })), paging: next ? { next } : undefined });

describe("importHistoryChunk", () => {
  it("imports one page, stores the cursor, and reports done when there is no next page", async () => {
    const store = fakePlanStore();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page(["1", "2"], "https://graph.facebook.com/v21.0/p/posts?after=x")), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page(["3"], null)), { status: 200 }));
    const conn = { config: { page_id: "p" }, secret: { page_access_token: "T" } };
    const a = await importHistoryChunk(store, { brandId: BRAND.id, platform: "facebook", fetchImpl: fetchImpl as unknown as typeof fetch, connection: conn });
    expect(a).toEqual({ imported: 2, done: false });
    expect(store.cursor.facebook).toContain("after=x");
    const b = await importHistoryChunk(store, { brandId: BRAND.id, platform: "facebook", fetchImpl: fetchImpl as unknown as typeof fetch, connection: conn });
    expect(b).toEqual({ imported: 1, done: true });
    expect(store.cursor.facebook).toBeNull();
    expect(store.history).toHaveLength(3);
  });
  it("fails clearly without a Meta connection", async () => {
    const store = fakePlanStore();
    await expect(importHistoryChunk(store, { brandId: BRAND.id, platform: "facebook", connection: null })).rejects.toThrow(/Meta/);
  });
});

describe("mirrorPublishedTarget", () => {
  it("writes a history row linked to the post", async () => {
    const store = fakePlanStore();
    await mirrorPublishedTarget(store, { brandId: BRAND.id, postId: "post1", platform: "instagram", externalId: "ig9", externalUrl: "https://ig/9", caption: "Hi", media: [{ url: "https://x/1.jpg" }], publishedAt: "2026-09-14T22:30:00.000Z" });
    expect(store.history[0]).toMatchObject({ platform: "instagram", external_id: "ig9", post_id: "post1", caption: "Hi", media: [{ url: "https://x/1.jpg", kind: "image" }], permalink: "https://ig/9" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/plan/history-sync.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/plan/history-sync.ts
import { fetchHistoryPage } from "@/lib/meta/history";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import type { MetaConfig, MetaSecret } from "@/lib/connections/meta";
import type { PlanStore } from "./store";

type Conn = { config: { page_id: string; ig_user_id?: string | null }; secret: { page_access_token: string } } | null;

/** One Graph page of history for a brand+platform. Pass `connection` to skip the DB lookup (tests). */
export async function importHistoryChunk(store: PlanStore, i: { brandId: string; platform: "facebook" | "instagram"; since?: string; fetchImpl?: typeof fetch; connection?: Conn }): Promise<{ imported: number; done: boolean }> {
  const conn = i.connection === undefined ? await getConnectionWithSecret<MetaConfig, MetaSecret>(i.brandId, "meta") : i.connection;
  if (!conn) throw new Error("Connect Meta on the brand before importing history");
  const cursor = await store.getHistoryCursor(i.brandId);
  const page = await fetchHistoryPage({ platform: i.platform, token: conn.secret.page_access_token, pageId: conn.config.page_id, igUserId: conn.config.ig_user_id ?? undefined, cursorUrl: cursor[i.platform] ?? null, since: i.since, fetchImpl: i.fetchImpl });
  const imported = await store.upsertHistory(i.brandId, page.rows);
  const done = page.next === null;
  await store.setHistoryCursor(i.brandId, { ...cursor, [i.platform]: page.next }, done);
  return { imported, done };
}

/** Nightly: last 30 days for every active brand with Meta connected; one page per platform is plenty for a daily delta. */
export async function topUpHistoryForAllBrands(store: PlanStore): Promise<{ brands: number; imported: number }> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  let brands = 0, imported = 0;
  for (const b of await store.listActiveBrands()) {
    const conn = await getConnectionWithSecret<MetaConfig, MetaSecret>(b.id, "meta");
    if (!conn) continue;
    brands++;
    // Top-ups start fresh (no cursor) so they never resume a stale backfill URL.
    const cursor = await store.getHistoryCursor(b.id);
    await store.setHistoryCursor(b.id, { ...cursor, facebook: null, instagram: null }, false);
    for (const platform of ["facebook", "instagram"] as const) {
      try { imported += (await importHistoryChunk(store, { brandId: b.id, platform, since, connection: conn })).imported; } catch { /* per-brand errors must not stop the cycle */ }
    }
  }
  return { brands, imported };
}

export async function mirrorPublishedTarget(store: PlanStore, i: { brandId: string; postId: string; platform: "facebook" | "instagram"; externalId: string; externalUrl: string | null; caption: string; media: { url: string }[]; publishedAt: string }): Promise<void> {
  await store.upsertHistory(i.brandId, [{ platform: i.platform, external_id: i.externalId, published_at: i.publishedAt, caption: i.caption, media: i.media.map((m) => ({ url: m.url, kind: "image" as const })), permalink: i.externalUrl, likes: 0, comments: 0, shares: 0, reach: null }], i.postId);
}
```

Check `MetaConfig` for the IG user id field name (`grep -n "ig_user_id\|instagram" src/lib/connections/meta.ts`) and use exactly that key in the `Conn` type and the `igUserId` argument.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/plan/history-sync.test.ts` — Expected: PASS (3).

- [ ] **Step 5: Mirror on publish**

In `src/lib/publishers/run.ts`, `processTarget` receives `target` and `deps`. After each successful `deps.save(target.id, { status: "published", external_id: ..., external_url: ..., published_at: ... })` (both branches, lines ~46 and ~58), the caller must also mirror. Rather than threading a store into `RunDeps`, do it in the cycle function that loads targets with their post: find where `processTarget` is called in `runPublishCycle` (same file, ~line 108) and after `if (r === "published")` add:

```ts
      if (r === "published" && (t.platform === "facebook" || t.platform === "instagram")) {
        const { data: fresh } = await admin.from("post_targets").select("external_id,external_url,caption,published_at,post:posts(brand_id,media)").eq("id", t.id).maybeSingle();
        const post = fresh?.post as unknown as { brand_id: string; media: { url: string }[] } | null;
        if (fresh?.external_id && post) {
          await mirrorPublishedTarget(createSupabasePlanStore(), { brandId: post.brand_id, postId: t.post_id, platform: t.platform, externalId: fresh.external_id, externalUrl: fresh.external_url, caption: fresh.caption, media: post.media ?? [], publishedAt: fresh.published_at ?? new Date().toISOString() }).catch(() => {});
        }
      }
```

with imports `import { mirrorPublishedTarget } from "@/lib/plan/history-sync"; import { createSupabasePlanStore } from "@/lib/plan/store";`. Use the variable names actually in that loop (`t`, `admin`) — read the function first.

Then the insights cycle should refresh mirrored rows: in `src/lib/insights/run.ts` after `admin.from("post_targets").update({ insights ... })` add

```ts
      await admin.from("social_history").update({ likes: ins.likes, comments: ins.comments, shares: ins.shares ?? 0, reach: ins.reach ?? null, fetched_at: ins.fetched_at }).eq("brand_id", brandId).eq("platform", t.platform).eq("external_id", t.external_id);
```

- [ ] **Step 6: Nightly top-up**

```ts
// src/app/api/cron/insights/route.ts — add to the try block after pins
import { topUpHistoryForAllBrands } from "@/lib/plan/history-sync";
import { createSupabasePlanStore } from "@/lib/plan/store";
// …
    const history = await topUpHistoryForAllBrands(createSupabasePlanStore());
    return NextResponse.json({ ...posts, pins, history });
```

- [ ] **Step 7: Full tests + typecheck, commit**

Run: `npx vitest run && npx tsc --noEmit -p .` — Expected: all green.

```bash
git add src/lib/plan/history-sync.ts src/lib/plan/history-sync.test.ts src/lib/publishers/run.ts src/lib/insights/run.ts src/app/api/cron/insights/route.ts
git commit -m "feat(plan): Meta history import chunks, publish-time mirror, nightly top-up"
```

---

### Task 9: Server actions, queries, and the plan cron route

**Files:**
- Create: `src/lib/plan/actions.ts`
- Create: `src/lib/plan/queries.ts`
- Create: `src/app/api/cron/plan/route.ts`
- Test: `src/lib/plan/cron.test.ts`
- Modify: `src/lib/posts/actions.ts` (mark touched on save/reschedule), `src/lib/ai/schemas.ts` (`plan` on caption/promo input), `src/lib/ai/tools/write.ts` (`create_post` copies `plan`), `src/lib/ai/brief.ts` (lane in brief)

**Interfaces:**
- Produces server actions: `buildWeekAction(brandId, weekStart)`, `rebuildWeekAction(brandId, weekStart)`, `skipPlannedPostAction(postId)`, `useInsteadAction(postId, historyId)`, `approveDayAction(brandId, weekStart, date)`, `approveWeekAction(brandId, weekStart)`, `saveScheduleAction(brandId, prev, formData)`, `importHistoryAction(brandId, platform)`; all return `ActionResult`.
- Produces `runPlanCycle(store, now): Promise<{ built: string[]; skipped: string[]; failed: { brand: string; error: string }[] }>` used by the cron route.
- Produces queries: `getPlanPageData(brandId, weekStart)`.

- [ ] **Step 1: Write the failing cron test**

```ts
// src/lib/plan/cron.test.ts
import { describe, it, expect } from "vitest";
import { fakePlanStore, BRAND } from "./fake-store";
import { runPlanCycle } from "./cron";
import type { BrandSchedule } from "./types";

const schedule: BrandSchedule = { brand_id: "b1", recycle_cap: 3, rest_days_min: 60, rest_days_max: 90, history_synced_at: null, slots: [{ dow: 1, platform: "facebook", time: "15:30" }] };

describe("runPlanCycle", () => {
  it("builds next week for brands with a schedule and skips weeks already built", async () => {
    const store = fakePlanStore({ schedule, projects: [{ id: "p1", title: "P", url: null, category: null, state: null, images: [], imported_at: "2026-09-10T00:00:00Z" }] });
    const now = new Date("2026-09-14T13:00:00Z"); // Monday 06:00 Pacific
    const first = await runPlanCycle(store, now);
    expect(first).toEqual({ built: [`${BRAND.slug}:2026-09-21`], skipped: [], failed: [] });
    expect(store.posts[0]).toMatchObject({ status: "draft", plan: { week_start: "2026-09-21" } });
    const second = await runPlanCycle(store, now);
    expect(second).toEqual({ built: [], skipped: [`${BRAND.slug}:2026-09-21`], failed: [] });
  });
  it("skips brands without a schedule", async () => {
    const store = fakePlanStore({ schedule: null });
    expect(await runPlanCycle(store, new Date("2026-09-14T13:00:00Z"))).toEqual({ built: [], skipped: [`${BRAND.slug}:no-schedule`], failed: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/plan/cron.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement the cycle and route**

```ts
// src/lib/plan/cron.ts
import { materialiseWeek, weekStartFor } from "./materialise";
import { addDays } from "./timing";
import type { PlanStore } from "./store";

export async function runPlanCycle(store: PlanStore, now = new Date()): Promise<{ built: string[]; skipped: string[]; failed: { brand: string; error: string }[] }> {
  const out = { built: [] as string[], skipped: [] as string[], failed: [] as { brand: string; error: string }[] };
  for (const b of await store.listActiveBrands()) {
    const schedule = await store.getSchedule(b.id);
    if (!schedule || schedule.slots.length === 0) { out.skipped.push(`${b.slug}:no-schedule`); continue; }
    const nextWeek = addDays(weekStartFor(now, b.timezone), 7);
    if (await store.getPlanWeek(b.id, nextWeek)) { out.skipped.push(`${b.slug}:${nextWeek}`); continue; }
    try {
      await materialiseWeek(store, { brandId: b.id, weekStart: nextWeek, by: "cron", now });
      out.built.push(`${b.slug}:${nextWeek}`);
    } catch (e) {
      out.failed.push({ brand: b.slug, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
```

```ts
// src/app/api/cron/plan/route.ts
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { runPlanCycle } from "@/lib/plan/cron";
import { createSupabasePlanStore } from "@/lib/plan/store";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runPlanCycle(createSupabasePlanStore()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
export const GET = POST;
```

Run: `npx vitest run src/lib/plan/cron.test.ts` — Expected: PASS (2).

- [ ] **Step 4: Server actions**

```ts
// src/lib/plan/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { createSupabasePlanStore } from "./store";
import { materialiseWeek, rebuildWeek, useInstead } from "./materialise";
import { importHistoryChunk } from "./history-sync";
import { approvePost } from "@/lib/posts/actions";
import { zonedParts } from "./timing";
import type { ScheduleSlot } from "./types";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

async function user(): Promise<{ id: string } | null> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { id: user.id } : null;
}
function refresh() {
  revalidatePath("/plan");
  revalidatePath("/posts", "layout");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}
const wrap = async <T,>(fn: () => Promise<T>): Promise<ActionResult<T>> => {
  try { const data = await fn(); refresh(); return { ok: true, data }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
};

export async function buildWeekAction(brandId: string, weekStart: string): Promise<ActionResult<{ created: number; emptyDays: string[] }>> {
  const u = await user(); if (!u) return { ok: false, error: "Not signed in" };
  return wrap(() => materialiseWeek(createSupabasePlanStore(), { brandId, weekStart, by: u.id }));
}
export async function rebuildWeekAction(brandId: string, weekStart: string): Promise<ActionResult<{ removed: number; created: number }>> {
  const u = await user(); if (!u) return { ok: false, error: "Not signed in" };
  return wrap(() => rebuildWeek(createSupabasePlanStore(), { brandId, weekStart, by: u.id }));
}
export async function skipPlannedPostAction(postId: string): Promise<ActionResult> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  return wrap(async () => {
    const store = createSupabasePlanStore();
    const p = await store.getPlannedPost(postId);
    if (!p) throw new Error("Planned post not found");
    await store.discardPlannedPost(postId);
    await store.addSkipped(p.brand_id, p.plan.week_start, p.plan.candidate_id);
    return undefined;
  });
}
export async function useInsteadAction(postId: string, historyId: string): Promise<ActionResult<{ newPostId: string }>> {
  const u = await user(); if (!u) return { ok: false, error: "Not signed in" };
  return wrap(() => useInstead(createSupabasePlanStore(), { postId, historyId, by: u.id }));
}
/** Approves every pending planned post on `date` (brand-local); drafts without captions are reported, not approved. */
export async function approveDayAction(brandId: string, weekStart: string, date: string): Promise<ActionResult<{ approved: number; waiting: number }>> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  return wrap(async () => {
    const store = createSupabasePlanStore();
    const brand = await store.getBrand(brandId);
    const posts = (await store.listPlannedPosts(brandId, weekStart)).filter((p) => p.targets.some((t) => t.scheduled_at && zonedParts(t.scheduled_at, brand!.timezone).date === date));
    let approved = 0, waiting = 0;
    for (const p of posts) {
      if (p.status === "pending_approval" && p.targets.every((t) => t.caption.trim())) { const r = await approvePost(p.id); if (r.ok) approved++; else waiting++; }
      else if (p.status === "draft") waiting++;
    }
    return { approved, waiting };
  });
}
export async function approveWeekAction(brandId: string, weekStart: string): Promise<ActionResult<{ approved: number; waiting: number }>> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  return wrap(async () => {
    const store = createSupabasePlanStore();
    let approved = 0, waiting = 0;
    for (const p of await store.listPlannedPosts(brandId, weekStart)) {
      if (p.status === "pending_approval" && p.targets.every((t) => t.caption.trim())) { const r = await approvePost(p.id); if (r.ok) approved++; else waiting++; }
      else if (p.status === "draft") waiting++;
    }
    return { approved, waiting };
  });
}

const scheduleSchema = z.object({
  recycle_cap: z.coerce.number().int().min(0).max(7),
  rest_days_min: z.coerce.number().int().min(7).max(365),
  rest_days_max: z.coerce.number().int().min(7).max(730),
}).refine((s) => s.rest_days_max >= s.rest_days_min, { message: "Rest window max must be ≥ min" });
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Form fields: fb_0..fb_6 and ig_0..ig_6 as HH:mm or blank; recycle_cap; rest_days_min; rest_days_max. */
export async function saveScheduleAction(brandId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  const parsed = scheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid schedule" };
  const slots: ScheduleSlot[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (const [key, platform] of [["fb", "facebook"], ["ig", "instagram"]] as const) {
      const v = String(formData.get(`${key}_${dow}`) ?? "").trim();
      if (!v) continue;
      if (!TIME.test(v)) return { ok: false, error: `Time for ${platform} on day ${dow} must be HH:mm` };
      slots.push({ dow, platform, time: v });
    }
  }
  return wrap(async () => { await createSupabasePlanStore().saveSchedule(brandId, { slots, ...parsed.data }); return undefined; });
}

export async function importHistoryAction(brandId: string, platform: "facebook" | "instagram"): Promise<ActionResult<{ imported: number; done: boolean }>> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  return wrap(() => importHistoryChunk(createSupabasePlanStore(), { brandId, platform }));
}
```

`approvePost` in `src/lib/posts/actions.ts` is a server action that uses the signed-in user's Supabase client — calling it from another server action is fine (same request, same cookies).

- [ ] **Step 5: Mark touched on edit, pass plan through jobs**

In `src/lib/posts/actions.ts`, at the end of `savePost` (after the targets are written, before `refresh()`) and in any reschedule path, add:

```ts
  await createSupabasePlanStore().markTouched(postId);
```

with `import { createSupabasePlanStore } from "@/lib/plan/store";` — use the post id variable that function already has.

In `src/lib/ai/schemas.ts`:

```ts
export const planMetaSchema = z.object({ week_start: z.string(), lane: z.enum(["new_page", "recycle", "promo", "filler"]), reason: z.string(), candidate_id: z.string(), touched: z.boolean().default(false) });
export const captionInputSchema = /* existing */.extend({ plan: z.object({ lane: z.enum(["new_page", "recycle", "promo", "filler"]), reason: z.string() }).optional() });
export const promoInputSchema = z.object({ article_id: uuid, scheduled_after: z.string().datetime({ offset: true }).optional(), plan: planMetaSchema.optional() });
```

(Apply `.extend` to the actual `captionInputSchema` object; if it is not a `z.object`, add `plan` directly to its shape.)

In `src/lib/ai/tools/write.ts` `create_post` (the promo/rewrite terminal tool): read `plan` from the job input (`ctx` has the job via the brief — if not, accept an optional `plan` field on the tool input mirroring `planMetaSchema`) and pass it to `store.createPost` → in `src/lib/ai/store.ts` `createPost`, include `plan: input.plan ?? null` in the insert and add `plan?: PlanMeta` to `CreatePostInput`. Also add `plan?: { lane: string; reason: string }` to the caption/promo brief in `src/lib/ai/brief.ts`: `if (input.plan) brief.plan = input.plan;` with a one-line addition to `INSTRUCTIONS.caption` in `src/lib/ai/prompts/instructions.ts`: `"If brief.plan.lane is 'recycle' keep the original hook; if 'new_page' lead with the build facts; 'filler' is an evergreen showcase."`

- [ ] **Step 6: Queries for the page**

```ts
// src/lib/plan/queries.ts
import { createSupabasePlanStore } from "./store";
import { planWeek } from "./materialise";
import { onThisDay } from "./build";
import { zonedParts, addDays } from "./timing";
import type { PlannedPost, PlanWeek } from "./store";
import type { HistoryRow } from "./types";

export type PlanDay = { date: string; label: string; posts: (PlannedPost & { times: { platform: string; at: string }[] })[]; onThisDay: ReturnType<typeof onThisDay> };
export type PlanPageData = {
  week: PlanWeek | null; days: PlanDay[]; timingSource: string | null; emptyDays: string[]; weeksOnFile: string[];
  recyclePool: { id: string; title: string; interactions: number; published_at: string; platform: string }[];
  counts: { total: number; ready: number; waiting: number; approved: number };
  history: HistoryRow[];
};

export async function getPlanPageData(brandId: string, weekStart: string, tz: string): Promise<PlanPageData> {
  const store = createSupabasePlanStore();
  const [week, posts, weeksOnFile, history] = await Promise.all([store.getPlanWeek(brandId, weekStart), store.listPlannedPosts(brandId, weekStart), store.listPlanWeeks(brandId), store.listHistory(brandId)]);
  let preview: Awaited<ReturnType<typeof planWeek>> | null = null;
  try { preview = await planWeek(store, brandId, weekStart, new Date()); } catch { preview = null; }
  const days: PlanDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    const dayPosts = posts.filter((p) => p.targets.some((t) => t.scheduled_at && zonedParts(t.scheduled_at, tz).date === date)).map((p) => ({ ...p, times: p.targets.filter((t) => t.scheduled_at).map((t) => ({ platform: t.platform, at: t.scheduled_at! })) }));
    return { date, label, posts: dayPosts, onThisDay: onThisDay({ history, date, tz }) };
  });
  const counts = { total: posts.length, ready: posts.filter((p) => p.status === "pending_approval").length, waiting: posts.filter((p) => p.status === "draft").length, approved: posts.filter((p) => p.status === "approved").length };
  return {
    week, days, timingSource: week?.timing_source ?? preview?.timingSource ?? null, emptyDays: preview?.emptyDays ?? [], weeksOnFile,
    recyclePool: (preview?.recyclePool ?? []).map((c) => ({ id: c.history!.id, title: c.title, interactions: c.history!.interactions, published_at: c.history!.published_at, platform: c.history!.platform })),
    counts, history,
  };
}
```

- [ ] **Step 7: Typecheck, full tests, commit**

Run: `npx tsc --noEmit -p . && npx vitest run` — Expected: green.

```bash
git add src/lib/plan/actions.ts src/lib/plan/queries.ts src/lib/plan/cron.ts src/lib/plan/cron.test.ts src/app/api/cron/plan/route.ts src/lib/posts/actions.ts src/lib/ai/schemas.ts src/lib/ai/tools/write.ts src/lib/ai/store.ts src/lib/ai/brief.ts src/lib/ai/prompts/instructions.ts
git commit -m "feat(plan): server actions, page queries, Monday plan cron; plan lane flows through jobs"
```

---

### Task 10: Brand Schedule card + Import Meta history

**Files:**
- Create: `src/components/brands/schedule-form.tsx`
- Create: `src/components/brands/import-history.tsx`
- Modify: `src/app/(app)/brands/[slug]/page.tsx` (render the card)

**Interfaces:**
- Consumes: `saveScheduleAction`, `importHistoryAction` (Task 9); `createSupabasePlanStore().getSchedule` for initial values.

- [ ] **Step 1: Schedule form**

```tsx
// src/components/brands/schedule-form.tsx
"use client";
import { useActionState } from "react";
import { saveScheduleAction, type ActionResult } from "@/lib/plan/actions";
import type { BrandSchedule } from "@/lib/plan/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ScheduleForm({ brandId, schedule, sampleCount }: { brandId: string; schedule: BrandSchedule | null; sampleCount: number }) {
  const [state, action, pending] = useActionState(saveScheduleAction.bind(null, brandId), null as ActionResult | null);
  const time = (dow: number, platform: "facebook" | "instagram") => schedule?.slots.find((s) => s.dow === dow && s.platform === platform)?.time ?? "";
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-[4rem_1fr_1fr] gap-2 text-sm">
        <div />
        <div className="font-medium">Facebook</div>
        <div className="font-medium">Instagram</div>
        {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
          <div key={dow} className="contents">
            <Label className="self-center">{DAYS[dow]}</Label>
            <Input name={`fb_${dow}`} type="time" defaultValue={time(dow, "facebook")} aria-label={`Facebook ${DAYS[dow]}`} />
            <Input name={`ig_${dow}`} type="time" defaultValue={time(dow, "instagram")} aria-label={`Instagram ${DAYS[dow]}`} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1"><Label htmlFor="recycle_cap">Recycles per week</Label><Input id="recycle_cap" name="recycle_cap" type="number" defaultValue={schedule?.recycle_cap ?? 3} /></div>
        <div className="space-y-1"><Label htmlFor="rest_days_min">Rest at least (days)</Label><Input id="rest_days_min" name="rest_days_min" type="number" defaultValue={schedule?.rest_days_min ?? 60} /></div>
        <div className="space-y-1"><Label htmlFor="rest_days_max">Preferred by (days)</Label><Input id="rest_days_max" name="rest_days_max" type="number" defaultValue={schedule?.rest_days_max ?? 90} /></div>
      </div>
      <p className="text-xs text-muted-foreground">
        {sampleCount >= 50 ? `Times are refined from ${sampleCount} measured posts; blank days are never used.` : `Times come from this schedule until the brand has 50 measured posts (${sampleCount} so far).`}
      </p>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-muted-foreground">Schedule saved</p>}
      <Button type="submit" disabled={pending}>Save schedule</Button>
    </form>
  );
}
```

- [ ] **Step 2: Import history button (loops chunks until done)**

```tsx
// src/components/brands/import-history.tsx
"use client";
import { useState, useTransition } from "react";
import { importHistoryAction } from "@/lib/plan/actions";
import { Button } from "@/components/ui/button";

export function ImportHistory({ brandId, syncedAt, rows }: { brandId: string; syncedAt: string | null; rows: number }) {
  const [log, setLog] = useState<string>("");
  const [pending, start] = useTransition();
  const run = () => start(async () => {
    let total = 0;
    for (const platform of ["facebook", "instagram"] as const) {
      for (let page = 0; page < 400; page++) {
        const r = await importHistoryAction(brandId, platform);
        if (!r.ok) { setLog(`${platform}: ${r.error}`); return; }
        total += r.data!.imported;
        setLog(`${platform}: ${total} posts so far…`);
        if (r.data!.done) break;
      }
    }
    setLog(`Done — ${total} posts imported`);
  });
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{rows} posts on file{syncedAt ? ` · last synced ${new Date(syncedAt).toLocaleString()}` : ""}. Nightly top-ups cover the last 30 days.</p>
      <Button type="button" variant="outline" disabled={pending} onClick={run}>{pending ? "Importing…" : "Import Meta history"}</Button>
      {log && <p className="text-sm">{log}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Render on the brand page**

In `src/app/(app)/brands/[slug]/page.tsx`, load `const store = createSupabasePlanStore(); const [schedule, history] = await Promise.all([store.getSchedule(brand.id), store.listHistory(brand.id)]);` and add a card (use the same `Card` components the page already uses):

```tsx
<Card>
  <CardHeader><CardTitle className="text-base">Posting schedule</CardTitle></CardHeader>
  <CardContent className="space-y-6">
    <ScheduleForm brandId={brand.id} schedule={schedule} sampleCount={history.filter((h) => h.interactions > 0 || h.reach !== null).length} />
    <ImportHistory brandId={brand.id} syncedAt={schedule?.history_synced_at ?? null} rows={history.length} />
  </CardContent>
</Card>
```

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`, open `/brands/jamsam-digital`, fill Mon/Wed/Fri 15:30 / 17:30, save → "Schedule saved"; reload shows values. Click *Import Meta history* → progress then "Done — N posts imported". Check `select count(*) from social_history` via the Supabase dashboard or `/plan` later.

- [ ] **Step 5: Lint, commit**

```bash
npx eslint src/components/brands/schedule-form.tsx src/components/brands/import-history.tsx "src/app/(app)/brands/[slug]/page.tsx"
git add src/components/brands/schedule-form.tsx src/components/brands/import-history.tsx "src/app/(app)/brands/[slug]/page.tsx"
git commit -m "feat(plan): brand posting schedule card and Meta history import"
```

---

### Task 11: `/plan` page

**Files:**
- Create: `src/app/(app)/plan/page.tsx`
- Create: `src/components/plan/week-toolbar.tsx`, `src/components/plan/plan-day.tsx`, `src/components/plan/recycle-pool.tsx`
- Modify: `src/components/shell/sidebar.tsx` (nav item after Calendar)

**Interfaces:**
- Consumes: `getPlanPageData` (Task 9), the server actions, `weekStartFor`, `addDays`, `formatInZone`.

- [ ] **Step 1: Sidebar**

In `src/components/shell/sidebar.tsx` insert `{ href: "/plan", label: "Plan" },` after the Calendar entry.

- [ ] **Step 2: Page**

```tsx
// src/app/(app)/plan/page.tsx
import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { getPlanPageData } from "@/lib/plan/queries";
import { weekStartFor } from "@/lib/plan/materialise";
import { addDays } from "@/lib/plan/timing";
import { WeekToolbar } from "@/components/plan/week-toolbar";
import { PlanDay } from "@/components/plan/plan-day";
import { RecyclePool } from "@/components/plan/recycle-pool";

export const metadata = { title: "Plan" };

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week: weekParam } = await searchParams;
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];
  if (!brand) return <p className="text-muted-foreground">Create a brand first. <Link className="underline" href="/brands/new">New brand</Link></p>;
  const thisWeek = weekStartFor(new Date(), brand.timezone);
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(weekParam ?? "") ? weekParam! : thisWeek;
  const data = await getPlanPageData(brand.id, weekStart, brand.timezone);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Weekly plan</h1>
        <p className="text-sm text-muted-foreground">New project pages first, then proven posts due to run again, then promos and filler. Nothing goes out until you approve it.</p>
      </div>
      <WeekToolbar brandId={brand.id} brandSlug={brand.slug} weekStart={weekStart} thisWeek={thisWeek} prev={addDays(weekStart, -7)} next={addDays(weekStart, 7)} built={Boolean(data.week)} timingSource={data.timingSource} summary={data.week?.summary ?? null} counts={data.counts} weeksOnFile={data.weeksOnFile.length} emptyDays={data.emptyDays} />
      <RecyclePool pool={data.recyclePool} />
      <div className="space-y-4">
        {data.days.map((d) => <PlanDay key={d.date} brandId={brand.id} weekStart={weekStart} day={d} tz={brand.timezone} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Toolbar (client)**

```tsx
// src/components/plan/week-toolbar.tsx
"use client";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { buildWeekAction, rebuildWeekAction, approveWeekAction } from "@/lib/plan/actions";

type Props = { brandId: string; brandSlug: string; weekStart: string; thisWeek: string; prev: string; next: string; built: boolean; timingSource: string | null; summary: Record<string, number> | null; counts: { total: number; ready: number; waiting: number; approved: number }; weeksOnFile: number; emptyDays: string[] };

export function WeekToolbar(p: Props) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, done: (d: unknown) => string) => start(async () => { const r = await fn(); if (r.ok) toast.success(done(r.data)); else toast.error(r.error ?? "Failed"); });
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm"><Link href={`/plan?week=${p.prev}`}>← Previous</Link></Button>
        <span className="font-medium">Week of {p.weekStart}{p.weekStart === p.thisWeek ? " (this week)" : ""}</span>
        <Button asChild variant="outline" size="sm"><Link href={`/plan?week=${p.next}`}>Next →</Link></Button>
        <span className="text-xs text-muted-foreground">{p.weeksOnFile} planned week{p.weeksOnFile === 1 ? "" : "s"} on file</span>
      </div>
      {p.summary && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">{p.summary.new_page} new pages</Badge><Badge variant="secondary">{p.summary.recycle} recycles</Badge><Badge variant="secondary">{p.summary.promo} promos</Badge><Badge variant="secondary">{p.summary.filler} filler</Badge>
        </div>
      )}
      {p.timingSource && <p className="text-xs text-muted-foreground">Timing source: {p.timingSource}.{p.emptyDays.length ? ` No candidate for ${p.emptyDays.join(", ")}.` : ""}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {!p.built ? (
          <Button size="sm" disabled={pending} onClick={() => run(() => buildWeekAction(p.brandId, p.weekStart), (d) => `Built ${(d as { created: number }).created} posts`)}>Build this week</Button>
        ) : (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rebuildWeekAction(p.brandId, p.weekStart), (d) => `Rebuilt: removed ${(d as { removed: number }).removed}, created ${(d as { created: number }).created}`)}>Rebuild this week</Button>
        )}
        <span className="text-sm">{p.counts.approved} of {p.counts.total} approved · {p.counts.ready} ready · {p.counts.waiting} waiting on Claude</span>
        <Button size="sm" disabled={pending || p.counts.ready === 0} onClick={() => run(() => approveWeekAction(p.brandId, p.weekStart), (d) => `Approved ${(d as { approved: number }).approved}; ${(d as { waiting: number }).waiting} still need captions`)}>Approve week</Button>
        <Button asChild size="sm" variant="ghost"><Link href={`/brands/${p.brandSlug}`}>Schedule</Link></Button>
      </div>
      <p className="text-xs text-muted-foreground">Rebuilding discards untouched drafts and starts over. Anything you approved or edited is kept. Approve buttons only act on posts that already have captions.</p>
    </div>
  );
}
```

- [ ] **Step 4: Day component (client)**

```tsx
// src/components/plan/plan-day.tsx
"use client";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatInZone } from "@/lib/time/zoned";
import { approveDayAction, skipPlannedPostAction, useInsteadAction } from "@/lib/plan/actions";
import type { PlanDay as Day } from "@/lib/plan/queries";

const LANE: Record<string, string> = { new_page: "New page", recycle: "Recycle", promo: "Promo", filler: "Filler" };
const STATUS: Record<string, string> = { draft: "Waiting on Claude", pending_approval: "Ready to approve", approved: "Approved" };

export function PlanDay({ brandId, weekStart, day, tz }: { brandId: string; weekStart: string; day: Day; tz: string }) {
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => start(async () => { const r = await fn(); if (r.ok) toast.success(msg); else toast.error(r.error ?? "Failed"); });
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{day.label} <span className="font-normal text-muted-foreground">· {day.posts.length} planned</span></h2>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="ghost"><Link href={`/posts/new?date=${day.date}`}>+ Add another</Link></Button>
          <Button size="sm" variant="outline" disabled={pending || day.posts.every((p) => p.status !== "pending_approval")} onClick={() => act(() => approveDayAction(brandId, weekStart, day.date), "Day approved")}>Approve day</Button>
        </div>
      </div>
      {day.posts.length === 0 && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Nothing planned.</p>}
      {day.posts.map((p) => (
        <div key={p.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{LANE[p.plan.lane]}</Badge>
            <Link href={`/posts/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
            <Badge variant={p.status === "approved" ? "default" : "outline"}>{STATUS[p.status] ?? p.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{p.plan.reason}</p>
          <p className="mt-1 text-xs text-muted-foreground">{p.times.map((t) => `${t.platform === "facebook" ? "Facebook" : "Instagram"} ${formatInZone(t.at, tz)}`).join(" · ")}</p>
          <div className="mt-2 flex gap-2">
            <Button asChild size="sm" variant="outline"><Link href={`/posts/${p.id}`}>Edit</Link></Button>
            {p.status !== "approved" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => skipPlannedPostAction(p.id), "Skipped")}>Skip</Button>}
          </div>
          {day.onThisDay.length > 0 && p.status !== "approved" && (
            <div className="mt-3 rounded-md border border-dashed p-2">
              <p className="text-xs font-semibold uppercase">On this day in past years</p>
              {day.onThisDay.slice(0, 3).map((o) => (
                <div key={o.row.id} className="mt-1 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{o.row.caption.split("\n")[0] || "(no caption)"} <span className="text-xs text-muted-foreground">{o.row.published_at.slice(0, 10)} · {o.row.platform} · {o.label}</span></span>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => useInsteadAction(p.id, o.row.id), "Swapped in")}>Use this instead</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 5: Recycle pool (client, collapsible)**

```tsx
// src/components/plan/recycle-pool.tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RecyclePool({ pool }: { pool: { id: string; title: string; interactions: number; published_at: string; platform: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "What's in the recycle pool?"} ({pool.length})</Button>
      {open && (
        <ul className="mt-2 divide-y rounded-lg border text-sm">
          {pool.length === 0 && <li className="p-2 text-muted-foreground">Nothing rested and proven yet — import Meta history or wait for posts to age past the rest window.</li>}
          {pool.map((r) => <li key={r.id} className="flex justify-between gap-2 p-2"><span className="truncate">{r.title}</span><span className="shrink-0 text-muted-foreground">{r.platform} · {r.interactions} interactions · {r.published_at.slice(0, 10)}</span></li>)}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify in the browser**

`npm run dev` → `/plan`: Build this week creates posts; drafts show "Waiting on Claude"; work a caption job via the in-app runner or Claude; post becomes "Ready to approve"; Approve day approves only that one; Skip archives; Rebuild keeps edited posts. Confirm on `/calendar` and that nothing shows as published.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npx eslint "src/app/(app)/plan/page.tsx" src/components/plan src/components/shell/sidebar.tsx && npx tsc --noEmit -p .
git add "src/app/(app)/plan/page.tsx" src/components/plan src/components/shell/sidebar.tsx
git commit -m "feat(plan): /plan page — week toolbar, per-day cards, on-this-day, recycle pool"
```

---

### Task 12: E2E + teardown + MCP tool-list test + deploy checks

**Files:**
- Create: `e2e/plan.spec.ts`
- Modify: `e2e/global-teardown.ts`

- [ ] **Step 1: Teardown**

Add before the `brands` delete in `e2e/global-teardown.ts`:

```ts
  await fetch(`${url}/rest/v1/social_history?caption=like.E2E%20history%20*`, { method: "DELETE", headers });
  await fetch(`${url}/rest/v1/projects?title=like.E2E%20project%20*`, { method: "DELETE", headers });
```

(`brand_schedules` and `plan_weeks` cascade with the brand; planned posts are titled after the seeded projects and cascade too.)

- [ ] **Step 2: E2E spec**

```ts
// e2e/plan.spec.ts
import { test, expect } from "@playwright/test";

const stamp = Date.now();
const brandName = `E2E Brand Plan ${stamp}`;
const slug = `e2e-brand-plan-${stamp}`;

async function seed(brandSlug: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const [b] = (await (await fetch(`${url}/rest/v1/brands?slug=eq.${brandSlug}&select=id`, { headers })).json()) as { id: string }[];
  await fetch(`${url}/rest/v1/projects`, { method: "POST", headers, body: JSON.stringify([1, 2, 3].map((i) => ({ brand_id: b.id, title: `E2E project ${stamp}-${i}`, url: `https://example.com/e2e/${stamp}/${i}`, category: "Shops", state: "WA", images: [{ url: "https://example.com/e2e.jpg" }] }))) });
  const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
  await fetch(`${url}/rest/v1/social_history`, { method: "POST", headers, body: JSON.stringify({ brand_id: b.id, platform: "facebook", external_id: `e2e-${stamp}`, published_at: old, caption: `E2E history ${stamp}`, media: [{ url: "https://example.com/h.jpg", kind: "image" }], likes: 50 }) });
}

test("plan: schedule, build week, nothing auto-approved, approve day, calendar", async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL || !process.env.SUPABASE_SERVICE_ROLE_KEY, "E2E env not set");
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  await page.goto("/brands/new");
  await page.getByLabel("Client name").fill(brandName);
  await page.getByRole("button", { name: "Create brand" }).click();
  await expect(page).toHaveURL(new RegExp(`/brands/${slug}$`));
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: brandName }).click();
  await seed(slug);

  await page.getByLabel("Facebook Mon").fill("15:30");
  await page.getByLabel("Instagram Mon").fill("17:30");
  await page.getByLabel("Facebook Wed").fill("15:30");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText("Schedule saved")).toBeVisible();

  await page.goto("/plan?week=2030-01-07");
  await page.getByRole("button", { name: "Build this week" }).click();
  await expect(page.getByText(/Built 2 posts/)).toBeVisible();
  await expect(page.getByText("0 of 2 approved")).toBeVisible();
  await expect(page.getByText("Waiting on Claude").first()).toBeVisible();
  await expect(page.getByText("Ready to approve")).toBeVisible(); // the recycle
  await expect(page.getByText("Approved", { exact: true })).toHaveCount(0);

  // Approve the recycle's day; the draft (no caption) must stay unapproved.
  const recycleDay = page.locator("section", { hasText: "Recycle" });
  await recycleDay.getByRole("button", { name: "Approve day" }).click();
  await expect(page.getByText("1 of 2 approved")).toBeVisible();

  await page.goto("/calendar?month=2030-01");
  await expect(page.getByText(/Re-run: E2E history/).first()).toBeVisible();
});
```

- [ ] **Step 3: MCP tool-list test**

`src/lib/ai/mcp-server.test.ts` enumerates every tool name; this phase adds none, so it must still pass unchanged. Run: `npx vitest run src/lib/ai/mcp-server.test.ts` — Expected: PASS.

- [ ] **Step 4: Run everything**

Run: `npx vitest run && npx tsc --noEmit -p . && npx eslint src e2e && npx playwright test e2e/plan.spec.ts` — Expected: all green. If Playwright is flaky on the schedule inputs (`type="time"` needs `HH:mm` in some browsers), use `page.getByLabel(...).fill("15:30")` as written; Chromium accepts it.

- [ ] **Step 5: Commit, push, PR**

```bash
git add e2e/plan.spec.ts e2e/global-teardown.ts
git commit -m "test(plan): e2e schedule → build → approve day; teardown for history/projects"
git push -u origin phase-7-weekly-plan
gh pr create --title "Phase 7: Weekly Plan" --body "…summary + test plan; ends with the PR attribution lines from the session reminder…"
```

After merge: `npx vercel deploy --prod --yes` from a checkout of `main`, confirm `/api/cron/plan` returns 401 without the secret and `{ built, skipped, failed }` with it (curl with `Authorization: Bearer <cron_secret>` from `.env.local`), set the JamSam Digital schedule, import history, and build the current week.

---

## Self-review

**Spec coverage**
- Data model → Task 1. Timing → Task 2. Candidates → Task 3. buildWeek / onThisDay → Task 4. Meta history import → Tasks 5, 8. Materialisation, rebuild, skip, use-instead → Task 7 (+ actions in Task 9). Cron → Task 9 (+ pg_cron in Task 1). UI (/plan, brand schedule card, nav) → Tasks 10, 11. Dashboard "waiting on Claude" needs no work (drafts with jobs already count). AI/MCP `plan` lane through jobs and brief → Task 9 step 5. Approval guarantee → Task 7 test + Task 12 e2e. Testing section → each task's tests plus Task 12.
- Publish-time mirror + insights refresh of `social_history` → Task 8 step 5.

**Placeholder scan** — none; each code step is complete. Two "read the function first" notes (Task 8 step 5, Task 9 step 5) point at exact files/lines rather than leaving gaps.

**Type consistency** — `PlanStore` method names used in Tasks 7–11 match Task 6; `Candidate.id` prefixes (`project:`/`history:`/`article:`) are the same in Task 3, Task 6 `listUsage`, and Task 7; `materialiseWeek` returns `{ created, emptyDays, summary }` everywhere; `ActionResult` in `plan/actions.ts` carries `data` and the toolbar reads it that way.
