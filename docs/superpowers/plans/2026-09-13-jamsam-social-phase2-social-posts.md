# JamSam Social Phase 2 (Social Posts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose, approve, schedule and publish image posts to each brand's Facebook Page and Instagram account, with Meta OAuth connect, a calendar, recycling, and insights.

**Architecture:** Two new tables (`posts`, `post_targets`) with a post-level approval status and a target-level publish status. Publishing is a single idempotent cron endpoint that atomically claims due targets via a SQL function and calls thin Graph API publisher modules; Supabase pg_cron triggers it every minute. Meta OAuth is two route handlers plus a Page picker page. UI reuses Phase 1 shell, forms, and shadcn components.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres, pg_cron, pg_net), Meta Graph API v21.0, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-jamsam-social-phase2-social-posts-design.md`

## Global Constraints

- Branch: `phase-2-social-posts` (already exists, based on `main`). Commit after each task, Conventional Commits.
- Graph API base: `https://graph.facebook.com/v21.0`. All Graph calls go through `graphFetch` (Task 4); 20 s timeout.
- Post status enum: `draft, pending_approval, approved, publishing, published, failed, archived`. Target status enum: `pending, publishing, published, failed`. Platforms: `facebook, instagram`. Max 3 publish attempts.
- Media: 0–10 images for Facebook; Instagram requires ≥1.
- Cron endpoints require `Authorization: Bearer $CRON_SECRET`.
- All Server Actions return `{ ok: true, ... } | { ok: false, error: string }`; never throw to the client.
- Secrets (page tokens) only via `getConnectionWithSecret` / admin client in server code.
- Env additions: `META_APP_ID`, `META_APP_SECRET`, `CRON_SECRET`. `META_*` already set locally and on Vercel; `CRON_SECRET` is created in Task 1.
- Base UI buttons: use `nativeButton={false} render={<Link … />}` for link-buttons.
- No em dashes in UI copy.

---

### Task 1: Env, migration, types

**Files:**
- Modify: `src/lib/env.ts`, `vitest.config.ts` (test env), `src/lib/database.types.ts`, `.env.local`, `.env.example`
- Create: `supabase/migrations/0002_social_posts.sql`

**Interfaces:**
- Produces: `env.META_APP_ID`, `env.META_APP_SECRET`, `env.CRON_SECRET`; tables `posts`, `post_targets`, `app_settings`; SQL functions `claim_due_targets(max_rows int)`, `reset_stale_targets()`; types `Post`, `PostTarget` rows and enums `post_status`, `target_status`, `social_platform`, `post_source` on `Database`.

- [ ] **Step 1: Extend env schema**

In `src/lib/env.ts` add to the zod object and to the `parseEnv` call:

```ts
  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 chars (openssl rand -hex 32)"),
```

In `vitest.config.ts` `test.env` add `META_APP_ID: "123", META_APP_SECRET: "shh", CRON_SECRET: "test-cron-secret-0000"`.

Generate and store the secret:

```bash
S=$(openssl rand -hex 32); printf 'CRON_SECRET=%s\n' "$S" >> .env.local
for env in production preview; do npx vercel env add CRON_SECRET $env --type secret --value "$S" --yes --force; done
```

Add `META_APP_ID=`, `META_APP_SECRET=`, `CRON_SECRET=` lines to `.env.example`.

- [ ] **Step 2: Write the migration**

`supabase/migrations/0002_social_posts.sql`:

```sql
create type post_status     as enum ('draft','pending_approval','approved','publishing','published','failed','archived');
create type post_source     as enum ('manual','recycled','ai');
create type social_platform as enum ('facebook','instagram');
create type target_status   as enum ('pending','publishing','published','failed');

create table posts (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  title         text not null,
  link_url      text,
  media         jsonb not null default '[]'::jsonb,
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
create trigger posts_updated_at before update on posts for each row execute function set_updated_at();

create table post_targets (
  id                  uuid primary key default gen_random_uuid(),
  post_id             uuid not null references posts(id) on delete cascade,
  platform            social_platform not null,
  caption             text not null default '',
  scheduled_at        timestamptz,
  status              target_status not null default 'pending',
  external_id         text,
  external_url        text,
  published_at        timestamptz,
  error               text,
  attempts            int not null default 0,
  claimed_at          timestamptz,
  insights            jsonb,
  insights_fetched_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (post_id, platform)
);
create index post_targets_due_idx on post_targets (status, scheduled_at) where status = 'pending';
create trigger post_targets_updated_at before update on post_targets for each row execute function set_updated_at();

alter table posts        enable row level security;
alter table post_targets enable row level security;
create policy "authenticated full access" on posts        for all to authenticated using (true) with check (true);
create policy "authenticated full access" on post_targets for all to authenticated using (true) with check (true);

-- Server-only key/value settings (no policies: only service role / superuser can read)
create table app_settings (
  key   text primary key,
  value text not null
);
alter table app_settings enable row level security;

-- Atomically claim due targets so concurrent cron runs never double-publish.
create or replace function claim_due_targets(max_rows int default 10)
returns setof post_targets language sql security definer set search_path = public as $$
  with due as (
    select t.id
    from post_targets t
    join posts p on p.id = t.post_id
    where t.status = 'pending'
      and t.scheduled_at is not null
      and t.scheduled_at <= now()
      and p.status in ('approved','publishing')
      and t.attempts < 3
    order by t.scheduled_at
    limit max_rows
    for update of t skip locked
  )
  update post_targets t
  set status = 'publishing', claimed_at = now(), attempts = attempts + 1
  from due
  where t.id = due.id
  returning t.*;
$$;

-- A run that crashed leaves rows in 'publishing'; give them back after 10 minutes.
create or replace function reset_stale_targets()
returns int language sql security definer set search_path = public as $$
  with r as (
    update post_targets
    set status = 'pending', claimed_at = null
    where status = 'publishing' and claimed_at < now() - interval '10 minutes'
    returning 1
  )
  select count(*)::int from r;
$$;

-- Cron triggers (URL and secret come from app_settings, seeded outside this file)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'jamsam-publish-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select value from public.app_settings where key = 'cron_url') || '/api/cron/publish',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select value from public.app_settings where key = 'cron_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'jamsam-insights-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url := (select value from public.app_settings where key = 'cron_url') || '/api/cron/insights',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select value from public.app_settings where key = 'cron_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 3: Apply and seed settings**

```bash
DB_URL='postgresql://postgres:<password-url-encoded>@db.dpihndeejbirskdrjfeh.supabase.co:5432/postgres'
npx supabase db push --db-url "$DB_URL"
npx supabase db query --db-url "$DB_URL" "insert into app_settings(key,value) values ('cron_url','https://jamsam-social.vercel.app'),('cron_secret','<CRON_SECRET from .env.local>') on conflict (key) do update set value = excluded.value"
npx supabase db query --db-url "$DB_URL" "select jobname, schedule from cron.job"
```

Expected: two cron jobs listed.

- [ ] **Step 4: Extend `database.types.ts`**

Add rows and enums (hand-written, same style as Phase 1):

```ts
export type MediaItem = { url: string; alt?: string | null; media_asset_id?: string | null };
type PostRow = {
  id: string; brand_id: string; title: string; link_url: string | null; media: Json;
  source: "manual" | "recycled" | "ai"; recycled_from: string | null;
  status: "draft" | "pending_approval" | "approved" | "publishing" | "published" | "failed" | "archived";
  created_by: string | null; approved_by: string | null; approved_at: string | null; created_at: string; updated_at: string;
};
type PostTargetRow = {
  id: string; post_id: string; platform: "facebook" | "instagram"; caption: string; scheduled_at: string | null;
  status: "pending" | "publishing" | "published" | "failed"; external_id: string | null; external_url: string | null;
  published_at: string | null; error: string | null; attempts: number; claimed_at: string | null;
  insights: Json | null; insights_fetched_at: string | null; created_at: string; updated_at: string;
};
type AppSettingRow = { key: string; value: string };
```

Register: `posts: Table<PostRow, "brand_id" | "title">`, `post_targets: Table<PostTargetRow, "post_id" | "platform">`, `app_settings: Table<AppSettingRow, "key" | "value">`; enums `post_status`, `post_source`, `social_platform`, `target_status`; functions:

```ts
Functions: {
  claim_due_targets: { Args: { max_rows?: number }; Returns: PostTargetRow[] };
  reset_stale_targets: { Args: Record<string, never>; Returns: number };
};
```

- [ ] **Step 5: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add -A && git commit -m "feat(db): posts and post_targets, claim function, pg_cron triggers, env"
```

---

### Task 2: Post status machine and time helpers

**Files:**
- Create: `src/lib/posts/status.ts`, `src/lib/posts/status.test.ts`, `src/lib/time/zoned.ts`, `src/lib/time/zoned.test.ts`

**Interfaces:**
- Produces:
  - `derivePostStatus(current: PostStatus, targets: { status: TargetStatus }[]): PostStatus`
  - `validateForSubmit(input: { media: unknown[]; targets: { platform; enabled; caption; scheduled_at: string | null }[] }): string | null` (error message or null)
  - `zonedLocalToUtc(local: string /* YYYY-MM-DDTHH:mm */, tz: string): string /* ISO */`
  - `utcToZonedLocal(iso: string, tz: string): string /* YYYY-MM-DDTHH:mm */`
  - `formatInZone(iso: string, tz: string): string` (human, e.g. `Sep 14, 3:40 PM`)

- [ ] **Step 1: Failing tests**

`src/lib/posts/status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { derivePostStatus, validateForSubmit } from "@/lib/posts/status";

describe("derivePostStatus", () => {
  it("is publishing while any target is publishing", () => {
    expect(derivePostStatus("approved", [{ status: "publishing" }, { status: "pending" }])).toBe("publishing");
  });
  it("is published when all targets are published", () => {
    expect(derivePostStatus("publishing", [{ status: "published" }, { status: "published" }])).toBe("published");
  });
  it("is failed when a target failed and nothing is still pending", () => {
    expect(derivePostStatus("publishing", [{ status: "published" }, { status: "failed" }])).toBe("failed");
  });
  it("stays approved while a failed target has been retried (pending)", () => {
    expect(derivePostStatus("failed", [{ status: "published" }, { status: "pending" }])).toBe("approved");
  });
  it("leaves draft alone", () => {
    expect(derivePostStatus("draft", [{ status: "pending" }])).toBe("draft");
  });
});

describe("validateForSubmit", () => {
  const ok = { platform: "facebook" as const, enabled: true, caption: "hi", scheduled_at: "2026-09-14T22:00:00Z" };
  it("accepts a valid facebook-only post with no media", () => {
    expect(validateForSubmit({ media: [], targets: [ok] })).toBeNull();
  });
  it("requires at least one enabled target", () => {
    expect(validateForSubmit({ media: [], targets: [{ ...ok, enabled: false }] })).toMatch(/at least one platform/i);
  });
  it("requires caption and schedule on enabled targets", () => {
    expect(validateForSubmit({ media: [], targets: [{ ...ok, caption: " " }] })).toMatch(/caption/i);
    expect(validateForSubmit({ media: [], targets: [{ ...ok, scheduled_at: null }] })).toMatch(/schedule/i);
  });
  it("requires an image for instagram", () => {
    expect(validateForSubmit({ media: [], targets: [{ ...ok, platform: "instagram" }] })).toMatch(/instagram.*image/i);
  });
  it("caps media at 10", () => {
    expect(validateForSubmit({ media: new Array(11).fill({}), targets: [ok] })).toMatch(/10/);
  });
});
```

`src/lib/time/zoned.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zonedLocalToUtc, utcToZonedLocal, formatInZone } from "@/lib/time/zoned";

describe("zoned time", () => {
  it("converts LA local to UTC in PDT", () => {
    expect(zonedLocalToUtc("2026-07-30T15:40", "America/Los_Angeles")).toBe("2026-07-30T22:40:00.000Z");
  });
  it("converts LA local to UTC in PST", () => {
    expect(zonedLocalToUtc("2026-01-15T09:00", "America/Los_Angeles")).toBe("2026-01-15T17:00:00.000Z");
  });
  it("round-trips", () => {
    const iso = zonedLocalToUtc("2026-03-08T02:30", "America/Denver"); // DST gap day; still deterministic
    expect(utcToZonedLocal(iso, "America/Denver")).toMatch(/^2026-03-08T0[23]:30$/);
  });
  it("formats for humans", () => {
    expect(formatInZone("2026-07-30T22:40:00Z", "America/Los_Angeles")).toBe("Jul 30, 3:40 PM");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run src/lib/posts src/lib/time` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/lib/posts/status.ts`:

```ts
import type { Database } from "@/lib/database.types";

export type PostStatus = Database["public"]["Enums"]["post_status"];
export type TargetStatus = Database["public"]["Enums"]["target_status"];
export type Platform = Database["public"]["Enums"]["social_platform"];

export const PLATFORMS: Platform[] = ["facebook", "instagram"];
export const PLATFORM_LABELS: Record<Platform, string> = { facebook: "Facebook", instagram: "Instagram" };
export const MAX_MEDIA = 10;
export const MAX_ATTEMPTS = 3;

export function derivePostStatus(current: PostStatus, targets: { status: TargetStatus }[]): PostStatus {
  if (["draft", "pending_approval", "archived"].includes(current)) return current;
  if (targets.length === 0) return current;
  if (targets.some((t) => t.status === "publishing")) return "publishing";
  if (targets.every((t) => t.status === "published")) return "published";
  if (targets.some((t) => t.status === "pending")) return "approved";
  if (targets.some((t) => t.status === "failed")) return "failed";
  return current;
}

export type SubmitTarget = { platform: Platform; enabled: boolean; caption: string; scheduled_at: string | null };

export function validateForSubmit(input: { media: unknown[]; targets: SubmitTarget[] }): string | null {
  if (input.media.length > MAX_MEDIA) return `A post can have at most ${MAX_MEDIA} images`;
  const enabled = input.targets.filter((t) => t.enabled);
  if (enabled.length === 0) return "Enable at least one platform";
  for (const t of enabled) {
    const label = PLATFORM_LABELS[t.platform];
    if (!t.caption.trim()) return `${label} needs a caption`;
    if (!t.scheduled_at) return `${label} needs a schedule time`;
    if (t.platform === "instagram" && input.media.length === 0) return "Instagram posts need at least one image";
  }
  return null;
}
```

`src/lib/time/zoned.ts`:

```ts
/** Offset of `tz` from UTC in minutes at the instant `date`. */
function tzOffsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - date.getTime()) / 60_000;
}

/** "YYYY-MM-DDTHH:mm" wall-clock time in `tz` → ISO UTC string. */
export function zonedLocalToUtc(local: string, tz: string): string {
  const [d, t] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm);
  let utc = guess - tzOffsetMinutes(new Date(guess), tz) * 60_000;
  // second pass handles DST boundaries where the first offset guess was off
  utc = guess - tzOffsetMinutes(new Date(utc), tz) * 60_000;
  return new Date(utc).toISOString();
}

/** ISO UTC → "YYYY-MM-DDTHH:mm" wall-clock in `tz` (for <input type="datetime-local">). */
export function utcToZonedLocal(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function formatInZone(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(iso))
    .replace(",", ",");
}
```

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run src/lib/posts src/lib/time
git add -A && git commit -m "feat(posts): status machine, submit validation, timezone helpers"
```

---

### Task 3: Graph API client and Meta OAuth helpers

**Files:**
- Create: `src/lib/meta/graph.ts`, `src/lib/meta/graph.test.ts`, `src/lib/meta/oauth.ts`, `src/lib/meta/oauth.test.ts`

**Interfaces:**
- Produces:
  - `GRAPH = "https://graph.facebook.com/v21.0"`
  - `class GraphError extends Error { code?: number; status: number }`
  - `graphFetch<T>(path: string, opts: { token: string; method?: "GET" | "POST"; params?: Record<string, string>; body?: Record<string, unknown>; fetchImpl?: typeof fetch }): Promise<T>` — token added as `access_token`; POST bodies sent as `application/x-www-form-urlencoded` (Graph accepts JSON arrays as JSON strings inside form fields).
  - `signState(payload: { brand: string; nonce: string }): string`, `verifyState(state: string): { brand: string; nonce: string } | null` (HMAC-SHA256 with `CONNECTIONS_ENCRYPTION_KEY`, base64url).
  - `buildAuthUrl({ redirectUri, state }): string`, `META_SCOPES: string[]`
  - `exchangeCode({ code, redirectUri, fetchImpl? }): Promise<string>` (long-lived user token)
  - `listPages(userToken, fetchImpl?): Promise<PageCandidate[]>` where `PageCandidate = { id, name, access_token, ig_user_id?: string, ig_username?: string }`
  - `getMe(userToken): Promise<{ id: string; name: string }>`

- [ ] **Step 1: Failing tests**

`src/lib/meta/graph.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { graphFetch, GraphError } from "@/lib/meta/graph";

describe("graphFetch", () => {
  it("GETs with token and params", async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      expect(u.pathname).toBe("/v21.0/123");
      expect(u.searchParams.get("fields")).toBe("name");
      expect(u.searchParams.get("access_token")).toBe("tok");
      return new Response(JSON.stringify({ name: "Page" }), { status: 200 });
    });
    expect(await graphFetch<{ name: string }>("/123", { token: "tok", params: { fields: "name" }, fetchImpl: f as unknown as typeof fetch })).toEqual({ name: "Page" });
  });
  it("POSTs form-encoded with JSON-encoded arrays", async () => {
    const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init!.body as string);
      expect(body.get("message")).toBe("hi");
      expect(body.get("attached_media")).toBe('[{"media_fbid":"1"}]');
      expect(body.get("access_token")).toBe("tok");
      return new Response(JSON.stringify({ id: "9" }), { status: 200 });
    });
    expect(await graphFetch("/p/feed", { token: "tok", method: "POST", body: { message: "hi", attached_media: [{ media_fbid: "1" }] }, fetchImpl: f as unknown as typeof fetch })).toEqual({ id: "9" });
  });
  it("throws GraphError with the API message", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 400 }));
    await expect(graphFetch("/x", { token: "t", fetchImpl: f as unknown as typeof fetch })).rejects.toMatchObject({ name: "GraphError", code: 190, message: "Invalid OAuth access token" });
    await expect(graphFetch("/x", { token: "t", fetchImpl: f as unknown as typeof fetch })).rejects.toBeInstanceOf(GraphError);
  });
});
```

`src/lib/meta/oauth.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { signState, verifyState, buildAuthUrl, exchangeCode, listPages } from "@/lib/meta/oauth";

describe("oauth state", () => {
  it("round-trips and rejects tampering", () => {
    const s = signState({ brand: "acme", nonce: "n1" });
    expect(verifyState(s)).toEqual({ brand: "acme", nonce: "n1" });
    expect(verifyState(s.slice(0, -2) + "zz")).toBeNull();
    expect(verifyState("garbage")).toBeNull();
  });
});

describe("buildAuthUrl", () => {
  it("includes client id, redirect, scopes, state", () => {
    const u = new URL(buildAuthUrl({ redirectUri: "https://app/cb", state: "st" }));
    expect(u.origin + u.pathname).toBe("https://www.facebook.com/v21.0/dialog/oauth");
    expect(u.searchParams.get("client_id")).toBe("123");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app/cb");
    expect(u.searchParams.get("scope")).toContain("pages_manage_posts");
    expect(u.searchParams.get("state")).toBe("st");
  });
});

describe("exchangeCode", () => {
  it("exchanges code then upgrades to a long-lived token", async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      calls.push(u.searchParams.get("grant_type") ?? "code");
      return new Response(JSON.stringify({ access_token: calls.length === 1 ? "short" : "long" }), { status: 200 });
    });
    expect(await exchangeCode({ code: "c", redirectUri: "https://app/cb", fetchImpl: f as unknown as typeof fetch })).toBe("long");
    expect(calls).toEqual(["code", "fb_exchange_token"]);
  });
});

describe("listPages", () => {
  it("maps pages with instagram accounts", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: "1", name: "A", access_token: "ta", instagram_business_account: { id: "i1", username: "a_ig" } },
      { id: "2", name: "B", access_token: "tb" },
    ] }), { status: 200 }));
    expect(await listPages("u", f as unknown as typeof fetch)).toEqual([
      { id: "1", name: "A", access_token: "ta", ig_user_id: "i1", ig_username: "a_ig" },
      { id: "2", name: "B", access_token: "tb", ig_user_id: undefined, ig_username: undefined },
    ]);
  });
});
```

- [ ] **Step 2: Run, expect failure** — `npx vitest run src/lib/meta`

- [ ] **Step 3: Implement**

`src/lib/meta/graph.ts`:

```ts
import { fetchWithTimeout } from "@/lib/connections/http";

export const GRAPH = "https://graph.facebook.com/v21.0";

export class GraphError extends Error {
  code?: number;
  status: number;
  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.code = code;
  }
}

type Opts = {
  token: string;
  method?: "GET" | "POST";
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
};

export async function graphFetch<T = Record<string, unknown>>(path: string, opts: Opts): Promise<T> {
  const url = new URL(`${GRAPH}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
  const method = opts.method ?? "GET";
  let init: RequestInit = {};
  if (method === "GET") {
    url.searchParams.set("access_token", opts.token);
  } else {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.body ?? {})) {
      if (v === undefined || v === null) continue;
      form.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    form.set("access_token", opts.token);
    init = { method: "POST", body: form.toString(), headers: { "Content-Type": "application/x-www-form-urlencoded" } };
  }
  const res = await fetchWithTimeout(url, init, 20_000, opts.fetchImpl ?? fetch);
  const text = await res.text();
  let json: { error?: { message?: string; code?: number } } & T;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GraphError(`Graph API returned non-JSON (${res.status})`, res.status);
  }
  if (!res.ok || json.error) throw new GraphError(json.error?.message ?? `Graph API error ${res.status}`, res.status, json.error?.code);
  return json as T;
}
```

`src/lib/meta/oauth.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { GRAPH, graphFetch } from "./graph";

export const META_SCOPES = [
  "pages_show_list", "pages_manage_posts", "pages_read_engagement", "read_insights",
  "instagram_basic", "instagram_content_publish", "instagram_manage_insights", "business_management",
];

const b64u = (b: Buffer) => b.toString("base64url");
function hmac(data: string) {
  return b64u(createHmac("sha256", Buffer.from(env.CONNECTIONS_ENCRYPTION_KEY, "base64")).update(data).digest());
}

export function signState(payload: { brand: string; nonce: string }): string {
  const data = b64u(Buffer.from(JSON.stringify(payload)));
  return `${data}.${hmac(data)}`;
}

export function verifyState(state: string): { brand: string; nonce: string } | null {
  const [data, sig] = state.split(".");
  if (!data || !sig) return null;
  const expected = hmac(data);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString()) as { brand?: string; nonce?: string };
    return p.brand && p.nonce ? { brand: p.brand, nonce: p.nonce } : null;
  } catch {
    return null;
  }
}

export function buildAuthUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
  const u = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  u.searchParams.set("client_id", env.META_APP_ID);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", META_SCOPES.join(","));
  return u.toString();
}

export async function exchangeCode({ code, redirectUri, fetchImpl = fetch }: { code: string; redirectUri: string; fetchImpl?: typeof fetch }): Promise<string> {
  const short = new URL(`${GRAPH}/oauth/access_token`);
  short.searchParams.set("client_id", env.META_APP_ID);
  short.searchParams.set("client_secret", env.META_APP_SECRET);
  short.searchParams.set("redirect_uri", redirectUri);
  short.searchParams.set("code", code);
  const s = (await (await fetchImpl(short)).json()) as { access_token?: string; error?: { message: string } };
  if (!s.access_token) throw new Error(s.error?.message ?? "Code exchange failed");

  const long = new URL(`${GRAPH}/oauth/access_token`);
  long.searchParams.set("grant_type", "fb_exchange_token");
  long.searchParams.set("client_id", env.META_APP_ID);
  long.searchParams.set("client_secret", env.META_APP_SECRET);
  long.searchParams.set("fb_exchange_token", s.access_token);
  const l = (await (await fetchImpl(long)).json()) as { access_token?: string; error?: { message: string } };
  if (!l.access_token) throw new Error(l.error?.message ?? "Long-lived token exchange failed");
  return l.access_token;
}

export type PageCandidate = { id: string; name: string; access_token: string; ig_user_id?: string; ig_username?: string };

export async function listPages(userToken: string, fetchImpl: typeof fetch = fetch): Promise<PageCandidate[]> {
  const r = await graphFetch<{ data: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[] }>(
    "/me/accounts",
    { token: userToken, params: { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100" }, fetchImpl },
  );
  return r.data.map((p) => ({ id: p.id, name: p.name, access_token: p.access_token, ig_user_id: p.instagram_business_account?.id, ig_username: p.instagram_business_account?.username }));
}

export async function getMe(userToken: string, fetchImpl: typeof fetch = fetch): Promise<{ id: string; name: string }> {
  return graphFetch<{ id: string; name: string }>("/me", { token: userToken, params: { fields: "id,name" }, fetchImpl });
}
```

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run src/lib/meta
git add -A && git commit -m "feat(meta): graph client and oauth helpers"
```

---

### Task 4: Meta OAuth routes, page picker, Connect button

**Files:**
- Create: `src/app/api/auth/meta/start/route.ts`, `src/app/api/auth/meta/callback/route.ts`, `src/lib/meta/connect.ts`, `src/app/(app)/brands/[slug]/connections/meta/pick/page.tsx`, `src/app/(app)/brands/[slug]/connections/meta/pick/pick-form.tsx`, `src/components/brands/meta-connect.tsx`
- Modify: `src/components/brands/connection-card.tsx` (render `MetaConnect` above the form when `provider === "meta"`), `src/app/(app)/brands/[slug]/connections/page.tsx` (toast for `?meta_error` / `?meta_connected` via a small client component)

**Interfaces:**
- Produces: `saveMetaPage(brandId, page: PageCandidate, user: { id; name }): Promise<void>` (upserts `brand_connections`, encrypts `{ page_access_token }`, config `{ page_id, page_name, ig_user_id, ig_username, connected_via: "oauth", fb_user_id, fb_user_name }`, then `runConnectionTest`); server action `choosePage(brandSlug, pageId)`; `disconnectMeta(brandId)`.
- Cookies: `meta_oauth_nonce` (httpOnly, 10 min), `meta_pages` (httpOnly, encrypted JSON of candidates + brand, 10 min).

- [ ] **Step 1: connect helper**

`src/lib/meta/connect.ts`:

```ts
import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { encryptJson } from "@/lib/crypto";
import { runConnectionTest } from "@/lib/connections/actions";
import type { PageCandidate } from "./oauth";
import type { Json } from "@/lib/database.types";

export async function saveMetaPage(brandId: string, page: PageCandidate, user: { id: string; name: string }) {
  const admin = createAdminSupabase();
  const config = {
    page_id: page.id, page_name: page.name, ig_user_id: page.ig_user_id ?? null, ig_username: page.ig_username ?? null,
    connected_via: "oauth", fb_user_id: user.id, fb_user_name: user.name,
  } as Json;
  const { data, error } = await admin
    .from("brand_connections")
    .upsert({ brand_id: brandId, provider: "meta", config, secret: encryptJson({ page_access_token: page.access_token }), status: "not_connected" }, { onConflict: "brand_id,provider" })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not save connection");
  await runConnectionTest(data.id);
}

export async function disconnectMeta(brandId: string) {
  const admin = createAdminSupabase();
  await admin.from("brand_connections").delete().eq("brand_id", brandId).eq("provider", "meta");
}
```

- [ ] **Step 2: start route**

`src/app/api/auth/meta/start/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { buildAuthUrl, signState } from "@/lib/meta/oauth";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.NEXT_PUBLIC_APP_URL));
  const brand = req.nextUrl.searchParams.get("brand");
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });

  const nonce = randomBytes(16).toString("hex");
  const state = signState({ brand, nonce });
  const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/auth/meta/callback`;
  const res = NextResponse.redirect(buildAuthUrl({ redirectUri, state }));
  res.cookies.set("meta_oauth_nonce", nonce, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 600 });
  return res;
}
```

- [ ] **Step 3: callback route**

`src/app/api/auth/meta/callback/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { encryptJson } from "@/lib/crypto";
import { verifyState, exchangeCode, listPages, getMe } from "@/lib/meta/oauth";
import { saveMetaPage } from "@/lib/meta/connect";
import { getBrandBySlug } from "@/lib/brands/queries";

function back(slug: string, q: Record<string, string>) {
  const u = new URL(`/brands/${slug}/connections`, env.NEXT_PUBLIC_APP_URL);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return NextResponse.redirect(u);
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.NEXT_PUBLIC_APP_URL));

  const p = req.nextUrl.searchParams;
  const state = verifyState(p.get("state") ?? "");
  const nonce = req.cookies.get("meta_oauth_nonce")?.value;
  if (!state || !nonce || state.nonce !== nonce) return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  const slug = state.brand;

  if (p.get("error")) return back(slug, { meta_error: p.get("error_description") ?? "Facebook login was cancelled" });
  const code = p.get("code");
  if (!code) return back(slug, { meta_error: "No code returned" });

  try {
    const brand = await getBrandBySlug(slug);
    if (!brand) return back(slug, { meta_error: "Brand not found" });
    const token = await exchangeCode({ code, redirectUri: `${env.NEXT_PUBLIC_APP_URL}/api/auth/meta/callback` });
    const [me, pages] = await Promise.all([getMe(token), listPages(token)]);
    if (pages.length === 0) return back(slug, { meta_error: "This Facebook account has no Pages you manage" });

    if (pages.length === 1) {
      await saveMetaPage(brand.id, pages[0], me);
      return back(slug, { meta_connected: pages[0].name });
    }
    const res = NextResponse.redirect(new URL(`/brands/${slug}/connections/meta/pick`, env.NEXT_PUBLIC_APP_URL));
    res.cookies.set("meta_pages", encryptJson({ brandId: brand.id, me, pages }), { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 600 });
    res.cookies.delete("meta_oauth_nonce");
    return res;
  } catch (e) {
    return back(slug, { meta_error: e instanceof Error ? e.message : "Connection failed" });
  }
}
```

- [ ] **Step 4: page picker**

`src/app/(app)/brands/[slug]/connections/meta/pick/page.tsx`:

```tsx
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { decryptJson } from "@/lib/crypto";
import { getBrandBySlug } from "@/lib/brands/queries";
import type { PageCandidate } from "@/lib/meta/oauth";
import { PickForm } from "./pick-form";

export default async function PickPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const raw = (await cookies()).get("meta_pages")?.value;
  if (!raw) redirect(`/brands/${slug}/connections?meta_error=Session expired, connect again`);
  let payload: { brandId: string; pages: PageCandidate[] };
  try {
    payload = decryptJson(raw);
  } catch {
    redirect(`/brands/${slug}/connections?meta_error=Session expired, connect again`);
  }
  if (payload.brandId !== brand.id) redirect(`/brands/${slug}/connections?meta_error=Brand mismatch, connect again`);
  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Choose a Page for {brand.name}</h1>
      <PickForm slug={slug} pages={payload.pages.map((p) => ({ id: p.id, name: p.name, ig_username: p.ig_username ?? null }))} />
    </div>
  );
}
```

`pick-form.tsx` (client) with a radio list and a server action `choosePage(slug, pageId)` defined in `src/lib/meta/actions.ts`:

```ts
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decryptJson } from "@/lib/crypto";
import { getBrandBySlug } from "@/lib/brands/queries";
import { saveMetaPage, disconnectMeta as disconnect } from "./connect";
import type { PageCandidate } from "./oauth";
import { revalidatePath } from "next/cache";

export async function choosePage(slug: string, pageId: string): Promise<void> {
  const store = await cookies();
  const raw = store.get("meta_pages")?.value;
  const brand = await getBrandBySlug(slug);
  if (!raw || !brand) redirect(`/brands/${slug}/connections?meta_error=Session expired, connect again`);
  const payload = decryptJson<{ brandId: string; me: { id: string; name: string }; pages: PageCandidate[] }>(raw);
  const page = payload.pages.find((p) => p.id === pageId);
  if (!page || payload.brandId !== brand.id) redirect(`/brands/${slug}/connections?meta_error=Page not found`);
  await saveMetaPage(brand.id, page, payload.me);
  store.delete("meta_pages");
  revalidatePath(`/brands/${slug}/connections`);
  redirect(`/brands/${slug}/connections?meta_connected=${encodeURIComponent(page.name)}`);
}

export async function disconnectMeta(brandId: string, slug: string): Promise<void> {
  await disconnect(brandId);
  revalidatePath(`/brands/${slug}/connections`);
}
```

`pick-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { choosePage } from "@/lib/meta/actions";

export function PickForm({ slug, pages }: { slug: string; pages: { id: string; name: string; ig_username: string | null }[] }) {
  const [sel, setSel] = useState(pages[0]?.id ?? "");
  const [pending, start] = useTransition();
  return (
    <form action={() => start(() => choosePage(slug, sel))} className="space-y-4">
      <ul className="divide-y rounded-md border">
        {pages.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-3 p-3">
              <input type="radio" name="page" value={p.id} checked={sel === p.id} onChange={() => setSel(p.id)} />
              <span className="flex-1">
                <span className="font-medium">{p.name}</span>
                <span className="block text-xs text-muted-foreground">{p.ig_username ? `Instagram @${p.ig_username}` : "No Instagram linked"}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <Button type="submit" disabled={pending || !sel}>{pending ? "Connecting..." : "Connect this Page"}</Button>
    </form>
  );
}
```

- [ ] **Step 5: MetaConnect component and card integration**

`src/components/brands/meta-connect.tsx`:

```tsx
"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { disconnectMeta } from "@/lib/meta/actions";

export function MetaConnect({ brandId, slug, connected }: { brandId: string; slug: string; connected: { page_name?: string; ig_username?: string | null; connected_via?: string } | null }) {
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      {connected?.page_name ? (
        <p className="text-sm">
          Connected to <strong>{connected.page_name}</strong>
          {connected.ig_username ? <> · Instagram <strong>@{connected.ig_username}</strong></> : <> · Instagram not linked</>}
          {connected.connected_via === "oauth" ? "" : " (pasted token)"}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Connect a Facebook Page and its Instagram account with one click.</p>
      )}
      <div className="flex gap-2">
        <Button nativeButton={false} render={<a href={`/api/auth/meta/start?brand=${encodeURIComponent(slug)}`} />}>
          {connected?.page_name ? "Reconnect" : "Connect Facebook"}
        </Button>
        {connected?.page_name && (
          <Button variant="outline" disabled={pending} onClick={() => confirm("Disconnect this Page?") && start(() => disconnectMeta(brandId, slug))}>
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}
```

In `connection-card.tsx`, add a `slug: string` prop, and when `provider === "meta"` render `<MetaConnect brandId={brandId} slug={slug} connected={cfg as never} />` above the form, and wrap the pasted-token form in a `<details><summary>Paste a token instead</summary>…</details>`. Pass `slug={brand.slug}` from the connections page.

In the connections page, add `src/components/brands/connections-toast.tsx` (client) that reads `useSearchParams()` and fires `toast.success("Connected " + meta_connected)` / `toast.error(meta_error)` once on mount, then `router.replace` to strip the params.

- [ ] **Step 6: Manual verification**

Local: `npm run dev`, go to a brand's Connections, click Connect Facebook → Facebook dialog → back to app with green Meta badge, Page + IG shown. Also verify on production after deploy (the redirect URI is the production one, so local testing needs `NEXT_PUBLIC_APP_URL=https://jamsam-social.vercel.app` in the callback or a second redirect URI `http://localhost:3000/api/auth/meta/callback` added in Meta settings — add the localhost one).

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint && npm test
git add -A && git commit -m "feat(meta): OAuth connect flow with page picker"
```

---

### Task 5: Publishers (Facebook, Instagram)

**Files:**
- Create: `src/lib/publishers/types.ts`, `src/lib/publishers/facebook.ts`, `src/lib/publishers/facebook.test.ts`, `src/lib/publishers/instagram.ts`, `src/lib/publishers/instagram.test.ts`

**Interfaces:**
- Produces:
  - `type PublishInput = { caption: string; link_url: string | null; media: { url: string }[] }`
  - `type PublishResult = { external_id: string; external_url: string | null }`
  - `publishToFacebook(pageId, token, input, fetchImpl?): Promise<PublishResult>`
  - `publishToInstagram(igUserId, token, input, opts?: { fetchImpl?, sleep?: (ms) => Promise<void> }): Promise<PublishResult>`

- [ ] **Step 1: Failing tests**

`facebook.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { publishToFacebook } from "@/lib/publishers/facebook";

function mockGraph(handlers: Record<string, (body: URLSearchParams) => unknown>) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace("/v21.0", "");
    const body = new URLSearchParams((init?.body as string) ?? "");
    const h = handlers[path];
    if (!h) return new Response(JSON.stringify({ error: { message: `no handler ${path}` } }), { status: 400 });
    return new Response(JSON.stringify(h(body)), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("publishToFacebook", () => {
  it("text/link post uses /feed", async () => {
    const f = mockGraph({ "/p1/feed": (b) => { expect(b.get("message")).toBe("hi"); expect(b.get("link")).toBe("https://x"); return { id: "p1_9" }; } });
    expect(await publishToFacebook("p1", "t", { caption: "hi", link_url: "https://x", media: [] }, f)).toEqual({ external_id: "p1_9", external_url: "https://www.facebook.com/p1_9" });
  });
  it("single photo uses /photos", async () => {
    const f = mockGraph({ "/p1/photos": (b) => { expect(b.get("url")).toBe("https://img/1.jpg"); expect(b.get("message")).toBe("hi"); return { id: "ph", post_id: "p1_10" }; } });
    expect(await publishToFacebook("p1", "t", { caption: "hi", link_url: null, media: [{ url: "https://img/1.jpg" }] }, f)).toEqual({ external_id: "p1_10", external_url: "https://www.facebook.com/p1_10" });
  });
  it("multi photo uploads unpublished then attaches", async () => {
    let n = 0;
    const f = mockGraph({
      "/p1/photos": (b) => { expect(b.get("published")).toBe("false"); return { id: `ph${++n}` }; },
      "/p1/feed": (b) => { expect(b.get("attached_media")).toBe('[{"media_fbid":"ph1"},{"media_fbid":"ph2"}]'); return { id: "p1_11" }; },
    });
    expect(await publishToFacebook("p1", "t", { caption: "hi", link_url: null, media: [{ url: "a" }, { url: "b" }] }, f)).toEqual({ external_id: "p1_11", external_url: "https://www.facebook.com/p1_11" });
  });
});
```

`instagram.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { publishToInstagram } from "@/lib/publishers/instagram";

function mockGraph(handlers: Record<string, (body: URLSearchParams, url: URL) => unknown>) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const path = u.pathname.replace("/v21.0", "");
    const body = new URLSearchParams((init?.body as string) ?? "");
    const h = handlers[path];
    if (!h) return new Response(JSON.stringify({ error: { message: `no handler ${path}` } }), { status: 400 });
    return new Response(JSON.stringify(h(body, u)), { status: 200 });
  }) as unknown as typeof fetch;
}
const noSleep = async () => {};

describe("publishToInstagram", () => {
  it("rejects without media", async () => {
    await expect(publishToInstagram("ig", "t", { caption: "c", link_url: null, media: [] }, { fetchImpl: mockGraph({}), sleep: noSleep })).rejects.toThrow(/image/i);
  });
  it("single image: container, wait FINISHED, publish, permalink", async () => {
    const f = mockGraph({
      "/ig/media": (b) => { expect(b.get("image_url")).toBe("https://img/1.jpg"); expect(b.get("caption")).toBe("c"); return { id: "c1" }; },
      "/c1": () => ({ status_code: "FINISHED" }),
      "/ig/media_publish": (b) => { expect(b.get("creation_id")).toBe("c1"); return { id: "m1" }; },
      "/m1": () => ({ permalink: "https://instagram.com/p/abc" }),
    });
    expect(await publishToInstagram("ig", "t", { caption: "c", link_url: null, media: [{ url: "https://img/1.jpg" }] }, { fetchImpl: f, sleep: noSleep })).toEqual({ external_id: "m1", external_url: "https://instagram.com/p/abc" });
  });
  it("carousel: children then parent", async () => {
    let n = 0;
    const f = mockGraph({
      "/ig/media": (b) => {
        if (b.get("is_carousel_item") === "true") return { id: `ch${++n}` };
        expect(b.get("media_type")).toBe("CAROUSEL");
        expect(b.get("children")).toBe('["ch1","ch2"]');
        return { id: "parent" };
      },
      "/ch1": () => ({ status_code: "FINISHED" }), "/ch2": () => ({ status_code: "FINISHED" }), "/parent": () => ({ status_code: "FINISHED" }),
      "/ig/media_publish": () => ({ id: "m2" }),
      "/m2": () => ({ permalink: "https://instagram.com/p/def" }),
    });
    expect(await publishToInstagram("ig", "t", { caption: "c", link_url: null, media: [{ url: "a" }, { url: "b" }] }, { fetchImpl: f, sleep: noSleep })).toEqual({ external_id: "m2", external_url: "https://instagram.com/p/def" });
  });
  it("fails when the container errors", async () => {
    const f = mockGraph({ "/ig/media": () => ({ id: "c1" }), "/c1": () => ({ status_code: "ERROR", status: "Media too large" }) });
    await expect(publishToInstagram("ig", "t", { caption: "c", link_url: null, media: [{ url: "a" }] }, { fetchImpl: f, sleep: noSleep })).rejects.toThrow(/Media too large/);
  });
});
```

- [ ] **Step 2: Run, expect failure** — `npx vitest run src/lib/publishers`

- [ ] **Step 3: Implement**

`types.ts`:

```ts
export type PublishInput = { caption: string; link_url: string | null; media: { url: string }[] };
export type PublishResult = { external_id: string; external_url: string | null };
```

`facebook.ts`:

```ts
import { graphFetch } from "@/lib/meta/graph";
import type { PublishInput, PublishResult } from "./types";

export async function publishToFacebook(pageId: string, token: string, input: PublishInput, fetchImpl: typeof fetch = fetch): Promise<PublishResult> {
  const base = { token, method: "POST" as const, fetchImpl };
  let postId: string;
  if (input.media.length === 0) {
    const r = await graphFetch<{ id: string }>(`/${pageId}/feed`, { ...base, body: { message: input.caption, link: input.link_url ?? undefined } });
    postId = r.id;
  } else if (input.media.length === 1) {
    const r = await graphFetch<{ id: string; post_id?: string }>(`/${pageId}/photos`, { ...base, body: { url: input.media[0].url, message: input.caption } });
    postId = r.post_id ?? r.id;
  } else {
    const ids: string[] = [];
    for (const m of input.media) {
      const r = await graphFetch<{ id: string }>(`/${pageId}/photos`, { ...base, body: { url: m.url, published: "false" } });
      ids.push(r.id);
    }
    const r = await graphFetch<{ id: string }>(`/${pageId}/feed`, { ...base, body: { message: input.caption, attached_media: ids.map((id) => ({ media_fbid: id })) } });
    postId = r.id;
  }
  return { external_id: postId, external_url: `https://www.facebook.com/${postId}` };
}
```

`instagram.ts`:

```ts
import { graphFetch } from "@/lib/meta/graph";
import type { PublishInput, PublishResult } from "./types";

type Opts = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFinished(id: string, token: string, fetchImpl: typeof fetch, sleep: (ms: number) => Promise<void>) {
  for (let i = 0; i < 15; i++) {
    const r = await graphFetch<{ status_code?: string; status?: string }>(`/${id}`, { token, params: { fields: "status_code,status" }, fetchImpl });
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED") throw new Error(`Instagram container ${r.status_code}: ${r.status ?? "unknown"}`);
    await sleep(2000);
  }
  throw new Error("Instagram container did not finish processing in time");
}

export async function publishToInstagram(igUserId: string, token: string, input: PublishInput, opts: Opts = {}): Promise<PublishResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  if (input.media.length === 0) throw new Error("Instagram posts need at least one image");
  const post = { token, method: "POST" as const, fetchImpl };

  let creationId: string;
  if (input.media.length === 1) {
    const r = await graphFetch<{ id: string }>(`/${igUserId}/media`, { ...post, body: { image_url: input.media[0].url, caption: input.caption } });
    creationId = r.id;
  } else {
    const children: string[] = [];
    for (const m of input.media) {
      const r = await graphFetch<{ id: string }>(`/${igUserId}/media`, { ...post, body: { image_url: m.url, is_carousel_item: "true" } });
      children.push(r.id);
    }
    for (const c of children) await waitFinished(c, token, fetchImpl, sleep);
    const r = await graphFetch<{ id: string }>(`/${igUserId}/media`, { ...post, body: { media_type: "CAROUSEL", children, caption: input.caption } });
    creationId = r.id;
  }
  await waitFinished(creationId, token, fetchImpl, sleep);
  const pub = await graphFetch<{ id: string }>(`/${igUserId}/media_publish`, { ...post, body: { creation_id: creationId } });
  let permalink: string | null = null;
  try {
    permalink = (await graphFetch<{ permalink?: string }>(`/${pub.id}`, { token, params: { fields: "permalink" }, fetchImpl })).permalink ?? null;
  } catch {}
  return { external_id: pub.id, external_url: permalink };
}
```

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run src/lib/publishers
git add -A && git commit -m "feat(publishers): facebook and instagram publishers"
```

---

### Task 6: Publish cron endpoint and target runner

**Files:**
- Create: `src/lib/publishers/run.ts`, `src/lib/publishers/run.test.ts`, `src/lib/cron/auth.ts`, `src/app/api/cron/publish/route.ts`

**Interfaces:**
- Produces:
  - `isCronAuthorized(req: Request): boolean`
  - `processTarget(target: PostTargetRow, deps: { loadPost, loadMeta, publishFb, publishIg, save }): Promise<"published" | "failed" | "retry">` — dependency-injected for tests.
  - `runPublishCycle(): Promise<{ reset: number; claimed: number; published: number; failed: number; retried: number }>` — wires real deps.

- [ ] **Step 1: Failing tests for `processTarget`**

`run.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { processTarget } from "@/lib/publishers/run";

const target = { id: "t1", post_id: "p1", platform: "facebook", caption: "c", attempts: 1 } as never;
const post = { id: "p1", brand_id: "b1", link_url: null, media: [{ url: "u" }] } as never;

function deps(over: Partial<Parameters<typeof processTarget>[1]> = {}) {
  return {
    loadPost: vi.fn(async () => post),
    loadMeta: vi.fn(async () => ({ config: { page_id: "pg", ig_user_id: "ig" }, secret: { page_access_token: "tok" } })),
    publishFb: vi.fn(async () => ({ external_id: "x", external_url: "https://fb/x" })),
    publishIg: vi.fn(async () => ({ external_id: "y", external_url: null })),
    save: vi.fn(async () => {}),
    ...over,
  };
}

describe("processTarget", () => {
  it("publishes to facebook and saves published", async () => {
    const d = deps();
    expect(await processTarget(target, d)).toBe("published");
    expect(d.publishFb).toHaveBeenCalledWith("pg", "tok", { caption: "c", link_url: null, media: [{ url: "u" }] });
    expect(d.save).toHaveBeenCalledWith("t1", expect.objectContaining({ status: "published", external_id: "x" }));
  });
  it("retries on error when attempts remain", async () => {
    const d = deps({ publishFb: vi.fn(async () => { throw new Error("boom"); }) });
    expect(await processTarget(target, d)).toBe("retry");
    expect(d.save).toHaveBeenCalledWith("t1", expect.objectContaining({ status: "pending", error: "boom" }));
  });
  it("fails permanently on the third attempt", async () => {
    const d = deps({ publishFb: vi.fn(async () => { throw new Error("boom"); }) });
    expect(await processTarget({ ...target, attempts: 3 } as never, d)).toBe("failed");
    expect(d.save).toHaveBeenCalledWith("t1", expect.objectContaining({ status: "failed" }));
  });
  it("fails when the brand has no meta connection", async () => {
    const d = deps({ loadMeta: vi.fn(async () => null) });
    expect(await processTarget({ ...target, attempts: 3 } as never, d)).toBe("failed");
    expect(d.save).toHaveBeenCalledWith("t1", expect.objectContaining({ error: expect.stringMatching(/not connected/i) }));
  });
  it("fails instagram when no ig account is linked", async () => {
    const d = deps({ loadMeta: vi.fn(async () => ({ config: { page_id: "pg" }, secret: { page_access_token: "tok" } })) });
    expect(await processTarget({ ...target, platform: "instagram", attempts: 3 } as never, d)).toBe("failed");
    expect(d.save).toHaveBeenCalledWith("t1", expect.objectContaining({ error: expect.stringMatching(/instagram/i) }));
  });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

`src/lib/cron/auth.ts`:

```ts
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export function isCronAuthorized(req: Request): boolean {
  const h = req.headers.get("authorization") ?? "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : "";
  const want = env.CRON_SECRET;
  return given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
}
```

`src/lib/publishers/run.ts`:

```ts
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import type { MetaConfig, MetaSecret } from "@/lib/connections/meta";
import type { Database, MediaItem } from "@/lib/database.types";
import { derivePostStatus, MAX_ATTEMPTS } from "@/lib/posts/status";
import { publishToFacebook } from "./facebook";
import { publishToInstagram } from "./instagram";
import type { PublishInput, PublishResult } from "./types";

type Target = Database["public"]["Tables"]["post_targets"]["Row"];
type Post = Database["public"]["Tables"]["posts"]["Row"];
type TargetPatch = Partial<Pick<Target, "status" | "external_id" | "external_url" | "published_at" | "error" | "claimed_at">>;

export type RunDeps = {
  loadPost: (postId: string) => Promise<Post | null>;
  loadMeta: (brandId: string) => Promise<{ config: MetaConfig; secret: MetaSecret } | null>;
  publishFb: (pageId: string, token: string, input: PublishInput) => Promise<PublishResult>;
  publishIg: (igUserId: string, token: string, input: PublishInput) => Promise<PublishResult>;
  save: (targetId: string, patch: TargetPatch) => Promise<void>;
};

export async function processTarget(target: Target, deps: RunDeps): Promise<"published" | "failed" | "retry"> {
  const fail = async (message: string) => {
    const permanent = target.attempts >= MAX_ATTEMPTS;
    await deps.save(target.id, { status: permanent ? "failed" : "pending", error: message, claimed_at: null });
    return permanent ? "failed" : "retry";
  };
  try {
    const post = await deps.loadPost(target.post_id);
    if (!post) return fail("Post not found");
    const meta = await deps.loadMeta(post.brand_id);
    if (!meta) return fail("Meta is not connected for this brand");
    const input: PublishInput = { caption: target.caption, link_url: post.link_url, media: ((post.media as MediaItem[]) ?? []).map((m) => ({ url: m.url })) };
    let result: PublishResult;
    if (target.platform === "facebook") {
      result = await deps.publishFb(meta.config.page_id, meta.secret.page_access_token, input);
    } else {
      if (!meta.config.ig_user_id) return fail("No Instagram account is linked to the connected Page");
      result = await deps.publishIg(meta.config.ig_user_id, meta.secret.page_access_token, input);
    }
    await deps.save(target.id, { status: "published", external_id: result.external_id, external_url: result.external_url, published_at: new Date().toISOString(), error: null, claimed_at: null });
    return "published";
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export function realDeps(): RunDeps {
  const admin = createAdminSupabase();
  return {
    loadPost: async (id) => (await admin.from("posts").select("*").eq("id", id).maybeSingle()).data,
    loadMeta: async (brandId) => getConnectionWithSecret<MetaConfig, MetaSecret>(brandId, "meta"),
    publishFb: (p, t, i) => publishToFacebook(p, t, i),
    publishIg: (ig, t, i) => publishToInstagram(ig, t, i),
    save: async (id, patch) => {
      await admin.from("post_targets").update(patch).eq("id", id);
    },
  };
}

export async function syncPostStatus(postId: string) {
  const admin = createAdminSupabase();
  const [{ data: post }, { data: targets }] = await Promise.all([
    admin.from("posts").select("status").eq("id", postId).single(),
    admin.from("post_targets").select("status").eq("post_id", postId),
  ]);
  if (!post || !targets) return;
  const next = derivePostStatus(post.status, targets);
  if (next !== post.status) await admin.from("posts").update({ status: next }).eq("id", postId);
}

export async function runPublishCycle() {
  const admin = createAdminSupabase();
  const { data: resetCount } = await admin.rpc("reset_stale_targets");
  const { data: claimed, error } = await admin.rpc("claim_due_targets", { max_rows: 10 });
  if (error) throw new Error(error.message);
  const deps = realDeps();
  const counts = { reset: resetCount ?? 0, claimed: claimed?.length ?? 0, published: 0, failed: 0, retried: 0 };
  const postIds = new Set<string>();
  for (const t of claimed ?? []) {
    postIds.add(t.post_id);
    await admin.from("posts").update({ status: "publishing" }).eq("id", t.post_id).in("status", ["approved"]);
    const r = await processTarget(t, deps);
    if (r === "published") counts.published++;
    else if (r === "failed") counts.failed++;
    else counts.retried++;
  }
  for (const id of postIds) await syncPostStatus(id);
  return counts;
}
```

`src/app/api/cron/publish/route.ts`:

```ts
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { runPublishCycle } from "@/lib/publishers/run";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runPublishCycle());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
export const GET = POST;
```

- [ ] **Step 4: Run tests; smoke the endpoint locally**

```bash
npx vitest run src/lib/publishers
npm run dev &  # or reuse
curl -s -X POST localhost:3000/api/cron/publish -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
# expect {"reset":0,"claimed":0,"published":0,"failed":0,"retried":0}
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/cron/publish   # expect 401
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(cron): publish cycle with atomic claim and retries"
```

---

### Task 7: Post queries, form schema, and server actions

**Files:**
- Create: `src/lib/posts/schema.ts`, `src/lib/posts/schema.test.ts`, `src/lib/posts/queries.ts`, `src/lib/posts/actions.ts`

**Interfaces:**
- Produces:
  - `postFormSchema` (zod): `{ brand_id, title, link_url (nullable), media: MediaItem[], targets: { platform, enabled, caption, scheduled_local: string | null }[] }`; `parsePostForm(formData): PostFormInput` reads JSON from a hidden `payload` field.
  - `listPosts({ brandId?, status? }): Promise<PostWithTargets[]>`, `getPost(id): Promise<PostWithTargets | null>` where `PostWithTargets = Post & { targets: PostTarget[]; brand: { slug, name, timezone } }`.
  - Actions (all `(…) => Promise<ActionResult>` with `ActionResult = { ok: true; id?: string } | { ok: false; error: string }`): `savePost(prev, formData)`, `submitForApproval(id)`, `approvePost(id)`, `rejectPost(id)`, `publishNow(id)`, `recyclePost(id)`, `archivePost(id)`, `retryTarget(targetId)`, `rescheduleTarget(targetId, newIso)`.

- [ ] **Step 1: Failing schema test**

```ts
import { describe, it, expect } from "vitest";
import { postFormSchema } from "@/lib/posts/schema";

const base = { brand_id: "b", title: "T", link_url: "", media: [], targets: [{ platform: "facebook", enabled: true, caption: "c", scheduled_local: "2026-09-14T15:00" }] };

describe("postFormSchema", () => {
  it("normalises empty link to null and keeps targets", () => {
    const r = postFormSchema.parse(base);
    expect(r.link_url).toBeNull();
    expect(r.targets[0].scheduled_local).toBe("2026-09-14T15:00");
  });
  it("rejects more than 10 media", () => {
    expect(() => postFormSchema.parse({ ...base, media: new Array(11).fill({ url: "https://x/1.jpg" }) })).toThrow();
  });
  it("rejects non-http media urls", () => {
    expect(() => postFormSchema.parse({ ...base, media: [{ url: "ftp://x" }] })).toThrow();
  });
});
```

- [ ] **Step 2: Implement schema**

```ts
import { z } from "zod";

const mediaItem = z.object({ url: z.string().url().regex(/^https?:/), alt: z.string().nullable().optional(), media_asset_id: z.string().uuid().nullable().optional() });
const target = z.object({
  platform: z.enum(["facebook", "instagram"]),
  enabled: z.boolean(),
  caption: z.string().default(""),
  scheduled_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().optional().transform((v) => v ?? null),
});

export const postFormSchema = z.object({
  id: z.string().uuid().optional(),
  brand_id: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required").max(200),
  link_url: z.string().trim().transform((v) => (v === "" ? null : v)).nullable().optional().transform((v) => v ?? null)
    .refine((v) => v === null || z.string().url().safeParse(v).success, "Enter a valid link URL"),
  media: z.array(mediaItem).max(10, "At most 10 images"),
  targets: z.array(target).length(2),
});
export type PostFormInput = z.infer<typeof postFormSchema>;

export function parsePostForm(formData: FormData) {
  const raw = formData.get("payload");
  if (typeof raw !== "string") throw new Error("Missing payload");
  return postFormSchema.safeParse(JSON.parse(raw));
}
```

- [ ] **Step 3: Queries**

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type Post = Database["public"]["Tables"]["posts"]["Row"];
export type PostTarget = Database["public"]["Tables"]["post_targets"]["Row"];
export type PostWithTargets = Post & { targets: PostTarget[]; brand: { slug: string; name: string; timezone: string } };

const SELECT = "*, targets:post_targets(*), brand:brands(slug,name,timezone)";

export async function listPosts(opts: { brandId?: string; status?: Post["status"][]; limit?: number } = {}): Promise<PostWithTargets[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from("posts").select(SELECT).order("created_at", { ascending: false }).limit(opts.limit ?? 100);
  if (opts.brandId) q = q.eq("brand_id", opts.brandId);
  if (opts.status?.length) q = q.in("status", opts.status);
  else q = q.neq("status", "archived");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as unknown as PostWithTargets[];
}

export async function getPost(id: string): Promise<PostWithTargets | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("posts").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as PostWithTargets | null;
}

export async function listTargetsInRange(brandId: string, fromIso: string, toIso: string) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("post_targets")
    .select("*, post:posts!inner(id,title,status,brand_id)")
    .eq("post.brand_id", brandId)
    .gte("scheduled_at", fromIso)
    .lt("scheduled_at", toIso)
    .neq("post.status", "archived");
  if (error) throw new Error(error.message);
  return data;
}
```

- [ ] **Step 4: Actions**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { parsePostForm } from "./schema";
import { validateForSubmit, derivePostStatus, PLATFORMS } from "./status";
import { zonedLocalToUtc } from "@/lib/time/zoned";
import type { Json } from "@/lib/database.types";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

async function ctx() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

async function loadPostForAction(id: string) {
  const { supabase, user } = await ctx();
  if (!user) return { error: "Not signed in" as const };
  const { data: post } = await supabase.from("posts").select("*, targets:post_targets(*), brand:brands(slug,timezone)").eq("id", id).maybeSingle();
  if (!post) return { error: "Post not found" as const };
  return { supabase, user, post };
}

function refresh() {
  revalidatePath("/posts", "layout");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

export async function savePost(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = parsePostForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid post" };
  const input = parsed.data;
  const { data: brand } = await supabase.from("brands").select("timezone").eq("id", input.brand_id).single();
  if (!brand) return { ok: false, error: "Brand not found" };

  let id = input.id;
  if (id) {
    const { data: existing } = await supabase.from("posts").select("status").eq("id", id).single();
    if (!existing) return { ok: false, error: "Post not found" };
    if (["publishing", "published"].includes(existing.status)) return { ok: false, error: "Published posts cannot be edited. Recycle it instead." };
    // Editing anything approved or pending drops it back to draft for re-review.
    const { error } = await supabase.from("posts").update({ title: input.title, link_url: input.link_url, media: input.media as Json, status: "draft" }).eq("id", id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await supabase.from("posts").insert({ brand_id: input.brand_id, title: input.title, link_url: input.link_url, media: input.media as Json, created_by: user.id }).select("id").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not create post" };
    id = data.id;
  }

  for (const t of input.targets) {
    const scheduled_at = t.scheduled_local ? zonedLocalToUtc(t.scheduled_local, brand.timezone) : null;
    if (t.enabled) {
      const { error } = await supabase.from("post_targets").upsert(
        { post_id: id, platform: t.platform, caption: t.caption, scheduled_at, status: "pending", error: null },
        { onConflict: "post_id,platform" },
      );
      if (error) return { ok: false, error: error.message };
    } else {
      await supabase.from("post_targets").delete().eq("post_id", id).eq("platform", t.platform).neq("status", "published");
    }
  }
  refresh();
  return { ok: true, id };
}

export async function submitForApproval(id: string): Promise<ActionResult> {
  const r = await loadPostForAction(id);
  if ("error" in r) return { ok: false, error: r.error };
  if (r.post.status !== "draft") return { ok: false, error: "Only drafts can be submitted" };
  const media = (r.post.media as unknown[]) ?? [];
  const msg = validateForSubmit({ media, targets: PLATFORMS.map((p) => {
    const t = r.post.targets.find((x) => x.platform === p);
    return { platform: p, enabled: Boolean(t), caption: t?.caption ?? "", scheduled_at: t?.scheduled_at ?? null };
  }) });
  if (msg) return { ok: false, error: msg };
  await r.supabase.from("posts").update({ status: "pending_approval" }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function approvePost(id: string): Promise<ActionResult> {
  const r = await loadPostForAction(id);
  if ("error" in r) return { ok: false, error: r.error };
  if (r.post.status !== "pending_approval") return { ok: false, error: "Post is not awaiting approval" };
  await r.supabase.from("posts").update({ status: "approved", approved_by: r.user.id, approved_at: new Date().toISOString() }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function rejectPost(id: string): Promise<ActionResult> {
  const r = await loadPostForAction(id);
  if ("error" in r) return { ok: false, error: r.error };
  if (r.post.status !== "pending_approval") return { ok: false, error: "Post is not awaiting approval" };
  await r.supabase.from("posts").update({ status: "draft" }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function publishNow(id: string): Promise<ActionResult> {
  const r = await loadPostForAction(id);
  if ("error" in r) return { ok: false, error: r.error };
  if (!["draft", "pending_approval", "approved", "failed"].includes(r.post.status)) return { ok: false, error: "Post cannot be published from its current state" };
  const media = (r.post.media as unknown[]) ?? [];
  const msg = validateForSubmit({ media, targets: r.post.targets.map((t) => ({ platform: t.platform, enabled: true, caption: t.caption, scheduled_at: "now" })) });
  if (msg) return { ok: false, error: msg };
  const now = new Date().toISOString();
  await r.supabase.from("post_targets").update({ scheduled_at: now, status: "pending", error: null, attempts: 0 }).eq("post_id", id).neq("status", "published");
  await r.supabase.from("posts").update({ status: "approved", approved_by: r.user.id, approved_at: now }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function recyclePost(id: string): Promise<ActionResult> {
  const r = await loadPostForAction(id);
  if ("error" in r) return { ok: false, error: r.error };
  const { data: created, error } = await r.supabase.from("posts").insert({
    brand_id: r.post.brand_id, title: `Re-run: ${r.post.title.replace(/^Re-run: /, "")}`, link_url: r.post.link_url, media: r.post.media,
    source: "recycled", recycled_from: r.post.id, created_by: r.user.id,
  }).select("id").single();
  if (error || !created) return { ok: false, error: error?.message ?? "Could not recycle" };
  if (r.post.targets.length) {
    await r.supabase.from("post_targets").insert(r.post.targets.map((t) => ({ post_id: created.id, platform: t.platform, caption: t.caption })));
  }
  refresh();
  redirect(`/posts/${created.id}`);
}

export async function archivePost(id: string): Promise<ActionResult> {
  const r = await loadPostForAction(id);
  if ("error" in r) return { ok: false, error: r.error };
  if (r.post.status === "publishing") return { ok: false, error: "Wait for publishing to finish" };
  await r.supabase.from("posts").update({ status: "archived" }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function retryTarget(targetId: string): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data: t } = await supabase.from("post_targets").select("id,post_id,status").eq("id", targetId).single();
  if (!t || t.status !== "failed") return { ok: false, error: "Only failed targets can be retried" };
  await supabase.from("post_targets").update({ status: "pending", attempts: 0, error: null, scheduled_at: new Date().toISOString() }).eq("id", targetId);
  await supabase.from("posts").update({ status: "approved" }).eq("id", t.post_id);
  refresh();
  return { ok: true };
}

export async function rescheduleTarget(targetId: string, newIso: string): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data: t } = await supabase.from("post_targets").select("id,post_id,status,post:posts(status)").eq("id", targetId).single();
  if (!t || t.status !== "pending") return { ok: false, error: "Only unpublished targets can be moved" };
  const postStatus = (t.post as unknown as { status: string } | null)?.status;
  if (postStatus === "publishing") return { ok: false, error: "Post is publishing" };
  await supabase.from("post_targets").update({ scheduled_at: newIso }).eq("id", targetId);
  refresh();
  return { ok: true };
}

export { derivePostStatus };
```

- [ ] **Step 5: Test, typecheck, commit**

```bash
npx vitest run src/lib/posts && npm run typecheck
git add -A && git commit -m "feat(posts): schema, queries, and workflow actions"
```

---

### Task 8: Posts UI (list, composer, detail with actions)

**Files:**
- Create: `src/app/(app)/posts/page.tsx`, `src/app/(app)/posts/new/page.tsx`, `src/app/(app)/posts/[id]/page.tsx`, `src/components/posts/post-form.tsx`, `src/components/posts/media-picker.tsx`, `src/components/posts/post-actions.tsx`, `src/components/posts/status-badge.tsx`, `src/components/posts/post-row.tsx`
- Modify: `src/components/shell/sidebar.tsx` (add Posts, Calendar), `src/lib/media/queries.ts` (no change; reused)

**Interfaces:**
- Consumes: `savePost`, workflow actions (Task 7), `listMediaAssets` (Phase 1), `utcToZonedLocal`/`formatInZone` (Task 2), `PLATFORMS`, `PLATFORM_LABELS`.
- Produces: `<PostForm brand post? assets>` posting `payload` JSON via `savePost`; `<PostActions post>`; `<PostStatusBadge status>`.

- [ ] **Step 1: Sidebar**

Add `{ href: "/posts", label: "Posts" }` and `{ href: "/calendar", label: "Calendar" }` after Brands.

- [ ] **Step 2: Status badge**

```tsx
import { Badge } from "@/components/ui/badge";
import type { PostStatus, TargetStatus } from "@/lib/posts/status";

const POST: Record<PostStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-muted text-foreground" },
  pending_approval: { label: "Pending approval", cls: "bg-amber-100 text-amber-900" },
  approved: { label: "Scheduled", cls: "bg-blue-100 text-blue-900" },
  publishing: { label: "Publishing", cls: "bg-amber-200 text-amber-900" },
  published: { label: "Published", cls: "bg-green-600 text-white" },
  failed: { label: "Failed", cls: "bg-red-600 text-white" },
  archived: { label: "Archived", cls: "bg-muted text-muted-foreground" },
};
const TARGET: Record<TargetStatus, { label: string; cls: string }> = {
  pending: { label: "Scheduled", cls: "bg-blue-100 text-blue-900" },
  publishing: { label: "Publishing", cls: "bg-amber-200 text-amber-900" },
  published: { label: "Published", cls: "bg-green-600 text-white" },
  failed: { label: "Failed", cls: "bg-red-600 text-white" },
};
export function PostStatusBadge({ status }: { status: PostStatus }) {
  const s = POST[status];
  return <Badge className={`${s.cls} hover:${s.cls}`}>{s.label}</Badge>;
}
export function TargetStatusBadge({ status }: { status: TargetStatus }) {
  const s = TARGET[status];
  return <Badge className={`${s.cls} hover:${s.cls}`}>{s.label}</Badge>;
}
```

- [ ] **Step 3: Media picker (dialog over the brand library + URL paste)**

```tsx
"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MediaItem } from "@/lib/database.types";
import type { MediaAsset } from "@/lib/media/queries";

export function MediaPicker({ assets, value, onChange, max = 10 }: { assets: MediaAsset[]; value: MediaItem[]; onChange: (v: MediaItem[]) => void; max?: number }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const add = (item: MediaItem) => { if (value.length < max && !value.some((v) => v.url === item.url)) onChange([...value, item]); };
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= value.length) return; const next = [...value]; [next[i], next[j]] = [next[j], next[i]]; onChange(next); };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((m, i) => (
          <div key={m.url} className="relative w-24">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt={m.alt ?? ""} className="aspect-square w-24 rounded-md border object-cover" />
            <div className="mt-1 flex justify-between text-xs">
              <button type="button" onClick={() => move(i, -1)} aria-label="Move left">←</button>
              <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} aria-label="Remove" className="text-destructive">✕</button>
              <button type="button" onClick={() => move(i, 1)} aria-label="Move right">→</button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(true)} disabled={value.length >= max}>Choose from library</Button>
        <Input placeholder="or paste an image URL" value={url} onChange={(e) => setUrl(e.target.value)} className="max-w-sm" />
        <Button type="button" variant="outline" onClick={() => { if (/^https?:\/\//.test(url)) { add({ url }); setUrl(""); } }} disabled={!url || value.length >= max}>Add URL</Button>
      </div>
      <p className="text-xs text-muted-foreground">{value.length}/{max} images. First image is the cover.</p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Brand library</DialogTitle></DialogHeader>
          {assets.length === 0 ? <p className="text-sm text-muted-foreground">No images in this brand&apos;s library yet.</p> : (
            <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
              {assets.map((a) => (
                <button key={a.id} type="button" onClick={() => add({ url: a.public_url, alt: a.alt_text, media_asset_id: a.id })} className="overflow-hidden rounded-md border hover:ring-2 hover:ring-ring">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.public_url} alt={a.alt_text ?? ""} className="aspect-square w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Post form**

```tsx
"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MediaPicker } from "./media-picker";
import { savePost, type ActionResult } from "@/lib/posts/actions";
import { PLATFORMS, PLATFORM_LABELS, type Platform } from "@/lib/posts/status";
import { utcToZonedLocal } from "@/lib/time/zoned";
import type { MediaItem } from "@/lib/database.types";
import type { MediaAsset } from "@/lib/media/queries";
import type { PostWithTargets } from "@/lib/posts/queries";

type TargetState = { platform: Platform; enabled: boolean; caption: string; scheduled_local: string | null };

export function PostForm({ brand, post, assets }: { brand: { id: string; name: string; timezone: string }; post?: PostWithTargets; assets: MediaAsset[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(savePost, null);
  const [title, setTitle] = useState(post?.title ?? "");
  const [link, setLink] = useState(post?.link_url ?? "");
  const [media, setMedia] = useState<MediaItem[]>((post?.media as MediaItem[]) ?? []);
  const [targets, setTargets] = useState<TargetState[]>(PLATFORMS.map((p) => {
    const t = post?.targets.find((x) => x.platform === p);
    return { platform: p, enabled: post ? Boolean(t) : true, caption: t?.caption ?? "", scheduled_local: t?.scheduled_at ? utcToZonedLocal(t.scheduled_at, brand.timezone) : null };
  }));

  useEffect(() => {
    if (!state) return;
    if (state.ok) { toast.success("Saved"); if (state.id && !post) router.push(`/posts/${state.id}`); else router.refresh(); }
    else toast.error(state.error);
  }, [state, post, router]);

  const setT = (p: Platform, patch: Partial<TargetState>) => setTargets((ts) => ts.map((t) => (t.platform === p ? { ...t, ...patch } : t)));
  const payload = JSON.stringify({ id: post?.id, brand_id: brand.id, title, link_url: link, media, targets });

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="title">Title (internal)</Label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
        <div className="space-y-1"><Label htmlFor="link">Link URL (optional)</Label><Input id="link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></div>
      </div>
      <div className="space-y-1"><Label>Images</Label><MediaPicker assets={assets} value={media} onChange={setMedia} /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        {targets.map((t) => (
          <div key={t.platform} className="space-y-3 rounded-lg border p-4">
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" checked={t.enabled} onChange={(e) => setT(t.platform, { enabled: e.target.checked })} /> {PLATFORM_LABELS[t.platform]}
            </label>
            {t.enabled && (
              <>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`cap-${t.platform}`}>Caption</Label>
                  {t.platform === "instagram" && (
                    <button type="button" className="text-xs underline" onClick={() => setT("instagram", { caption: targets.find((x) => x.platform === "facebook")?.caption ?? "" })}>Copy from Facebook</button>
                  )}
                </div>
                <Textarea id={`cap-${t.platform}`} rows={10} value={t.caption} onChange={(e) => setT(t.platform, { caption: e.target.value })} />
                <p className="text-xs text-muted-foreground">{t.caption.length} characters{t.platform === "instagram" ? " (max 2,200)" : ""}</p>
                <div className="space-y-1">
                  <Label htmlFor={`when-${t.platform}`}>Schedule ({brand.timezone})</Label>
                  <Input id={`when-${t.platform}`} type="datetime-local" value={t.scheduled_local ?? ""} onChange={(e) => setT(t.platform, { scheduled_local: e.target.value || null })} />
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : post ? "Save changes" : "Create draft"}</Button>
    </form>
  );
}
```

- [ ] **Step 5: Post actions**

```tsx
"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { submitForApproval, approvePost, rejectPost, publishNow, recyclePost, archivePost, retryTarget, type ActionResult } from "@/lib/posts/actions";
import type { PostWithTargets } from "@/lib/posts/queries";

export function PostActions({ post }: { post: PostWithTargets }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult>, okMsg: string) => start(async () => {
    const r = await fn();
    if (r.ok) { toast.success(okMsg); router.refresh(); } else toast.error(r.error);
  });
  const s = post.status;
  return (
    <div className="flex flex-wrap gap-2">
      {s === "draft" && <Button disabled={pending} onClick={() => run(() => submitForApproval(post.id), "Submitted for approval")}>Submit for approval</Button>}
      {s === "pending_approval" && <>
        <Button disabled={pending} onClick={() => run(() => approvePost(post.id), "Approved and scheduled")}>Approve</Button>
        <Button variant="outline" disabled={pending} onClick={() => run(() => rejectPost(post.id), "Sent back to draft")}>Send back</Button>
      </>}
      {["draft", "pending_approval", "approved", "failed"].includes(s) && (
        <Button variant="outline" disabled={pending} onClick={() => confirm("Publish to all enabled platforms within the next minute?") && run(() => publishNow(post.id), "Publishing shortly")}>Publish now</Button>
      )}
      {s === "published" && <Button disabled={pending} onClick={() => start(() => recyclePost(post.id).then((r) => { if (!r.ok) toast.error(r.error); }))}>Recycle</Button>}
      {post.targets.some((t) => t.status === "failed") && post.targets.filter((t) => t.status === "failed").map((t) => (
        <Button key={t.id} variant="outline" disabled={pending} onClick={() => run(() => retryTarget(t.id), `Retrying ${t.platform}`)}>Retry {t.platform}</Button>
      ))}
      {s !== "publishing" && s !== "archived" && <Button variant="ghost" disabled={pending} onClick={() => confirm("Archive this post?") && run(() => archivePost(post.id), "Archived")}>Archive</Button>}
    </div>
  );
}
```

- [ ] **Step 6: Pages**

`/posts/page.tsx`: brand from `getCurrentBrandSlug` (like Media page), status filter from `?status=`, list rows (title, badge, per-target chip with `formatInZone`, insights line `♥ n · 💬 n` when present), "New post" button.

`/posts/new/page.tsx`: resolve current brand, `listMediaAssets(brand.id)`, render `<PostForm brand assets />`.

`/posts/[id]/page.tsx`: `getPost`; header with title + `PostStatusBadge` + `PostActions`; if status is `published`/`publishing` show read-only view (captions, media, per-target status/links/errors/insights); else render `<PostForm post …/>` below the actions plus a per-target status table. Include `recycled_from` link when set.

(Write these three pages in full; they compose only the components above plus Phase 1 helpers.)

- [ ] **Step 7: Manual check + commit**

Create a draft with two images → submit → approve → shows "Scheduled"; edit → back to draft. Commit `feat(posts): list, composer, and workflow UI`.

---

### Task 9: Calendar

**Files:**
- Create: `src/lib/calendar/grid.ts`, `src/lib/calendar/grid.test.ts`, `src/app/(app)/calendar/page.tsx`, `src/components/calendar/month-grid.tsx`

**Interfaces:**
- `monthGrid(year: number, month1to12: number): { days: { date: string /* YYYY-MM-DD */; inMonth: boolean }[]; weeks: number }` — 6 rows × 7 cols, weeks start Sunday.
- `moveKeepingTime(iso: string, newDay: string, tz: string): string` — same wall-clock time on `newDay` in `tz`, returns ISO UTC.
- `dayKeyInZone(iso: string, tz: string): string` — the `YYYY-MM-DD` a UTC instant falls on in `tz`.

- [ ] **Step 1: Tests**

```ts
import { describe, it, expect } from "vitest";
import { monthGrid, moveKeepingTime, dayKeyInZone } from "@/lib/calendar/grid";

describe("monthGrid", () => {
  it("starts on the Sunday on/before the 1st and has 42 cells", () => {
    const g = monthGrid(2026, 9); // Sep 1 2026 is a Tuesday
    expect(g.days).toHaveLength(42);
    expect(g.days[0]).toEqual({ date: "2026-08-30", inMonth: false });
    expect(g.days[2]).toEqual({ date: "2026-09-01", inMonth: true });
  });
});
describe("moveKeepingTime", () => {
  it("keeps 3:40 PM LA when moving days", () => {
    expect(moveKeepingTime("2026-07-30T22:40:00Z", "2026-08-02", "America/Los_Angeles")).toBe("2026-08-02T22:40:00.000Z");
  });
});
describe("dayKeyInZone", () => {
  it("uses the zone's date, not UTC's", () => {
    expect(dayKeyInZone("2026-07-31T05:30:00Z", "America/Los_Angeles")).toBe("2026-07-30");
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { utcToZonedLocal, zonedLocalToUtc } from "@/lib/time/zoned";

const pad = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function monthGrid(year: number, month: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return { date: key(d), inMonth: d.getUTCMonth() === month - 1 };
  });
  return { days, weeks: 6 };
}

export function dayKeyInZone(iso: string, tz: string): string {
  return utcToZonedLocal(iso, tz).slice(0, 10);
}

export function moveKeepingTime(iso: string, newDay: string, tz: string): string {
  const time = utcToZonedLocal(iso, tz).slice(11, 16);
  return zonedLocalToUtc(`${newDay}T${time}`, tz);
}
```

- [ ] **Step 3: Page + grid component**

`calendar/page.tsx`: parse `?month=YYYY-MM` (default current month in brand tz), compute grid, query `listTargetsInRange(brand.id, firstCellUtc, lastCellUtc)` using `zonedLocalToUtc(days[0].date + "T00:00")` and the day after the last cell, group targets by `dayKeyInZone`, render `<MonthGrid month days chips timezone />` with prev/next month links.

`month-grid.tsx` (client): 7-column grid; each chip is `draggable` (only when `status === "pending"`), `onDragStart` stores target id; each day cell `onDrop` calls `rescheduleTarget(id, moveKeepingTime(chip.scheduled_at, day, tz))` then `router.refresh()`; chips link to `/posts/[post_id]`; colour classes by status; platform shown as "FB"/"IG" prefix; title truncated.

- [ ] **Step 4: Test, manual drag check, commit** — `feat(calendar): month view with drag reschedule`.

---

### Task 10: Insights

**Files:**
- Create: `src/lib/insights/fetch.ts`, `src/lib/insights/fetch.test.ts`, `src/lib/insights/run.ts`, `src/app/api/cron/insights/route.ts`, `src/lib/insights/actions.ts` (`refreshInsights(postId)`)
- Modify: `src/app/(app)/posts/[id]/page.tsx` (show insights + Refresh button), `src/components/posts/post-row.tsx` (counts)

**Interfaces:**
- `fetchFacebookInsights(postId, token, fetchImpl?): Promise<Insights>` and `fetchInstagramInsights(mediaId, token, fetchImpl?): Promise<Insights>` where `Insights = { likes: number; comments: number; shares?: number; reach?: number; saved?: number; fetched_at: string }`.
- `runInsightsCycle(): Promise<{ updated: number; failed: number }>` — targets `published` in last 30 days; per-brand token via `getConnectionWithSecret`.

- [ ] **Step 1: Tests**

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchFacebookInsights, fetchInstagramInsights } from "@/lib/insights/fetch";

describe("insights", () => {
  it("facebook maps likes/comments/shares/reach", async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      expect(u.searchParams.get("fields")).toContain("likes.summary(true)");
      return new Response(JSON.stringify({ likes: { summary: { total_count: 5 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 }, insights: { data: [{ name: "post_impressions_unique", values: [{ value: 40 }] }] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await fetchFacebookInsights("p", "t", f);
    expect(r).toMatchObject({ likes: 5, comments: 2, shares: 1, reach: 40 });
  });
  it("instagram maps like/comments and reach/saved", async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/insights")) return new Response(JSON.stringify({ data: [{ name: "reach", values: [{ value: 30 }] }, { name: "saved", values: [{ value: 3 }] }] }), { status: 200 });
      return new Response(JSON.stringify({ like_count: 7, comments_count: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchInstagramInsights("m", "t", f)).toMatchObject({ likes: 7, comments: 1, reach: 30, saved: 3 });
  });
});
```

- [ ] **Step 2: Implement**

`fetch.ts`:

```ts
import { graphFetch } from "@/lib/meta/graph";

export type Insights = { likes: number; comments: number; shares?: number; reach?: number; saved?: number; fetched_at: string };

export async function fetchFacebookInsights(postId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<Insights> {
  const r = await graphFetch<{ likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number }; insights?: { data?: { name: string; values?: { value?: number }[] }[] } }>(
    `/${postId}`, { token, params: { fields: "likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions_unique)" }, fetchImpl },
  );
  const reach = r.insights?.data?.find((d) => d.name === "post_impressions_unique")?.values?.[0]?.value;
  return { likes: r.likes?.summary?.total_count ?? 0, comments: r.comments?.summary?.total_count ?? 0, shares: r.shares?.count ?? 0, reach, fetched_at: new Date().toISOString() };
}

export async function fetchInstagramInsights(mediaId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<Insights> {
  const base = await graphFetch<{ like_count?: number; comments_count?: number }>(`/${mediaId}`, { token, params: { fields: "like_count,comments_count" }, fetchImpl });
  let reach: number | undefined, saved: number | undefined;
  try {
    const ins = await graphFetch<{ data?: { name: string; values?: { value?: number }[] }[] }>(`/${mediaId}/insights`, { token, params: { metric: "reach,saved" }, fetchImpl });
    reach = ins.data?.find((d) => d.name === "reach")?.values?.[0]?.value;
    saved = ins.data?.find((d) => d.name === "saved")?.values?.[0]?.value;
  } catch {}
  return { likes: base.like_count ?? 0, comments: base.comments_count ?? 0, reach, saved, fetched_at: new Date().toISOString() };
}
```

`run.ts`: `runInsightsCycle({ postId? })` — select targets with `status='published' and published_at > now()-30d` (or `post_id = postId`), join posts for brand_id, group by brand, load token once per brand, fetch per target, update `insights`/`insights_fetched_at`; count failures without throwing.

`api/cron/insights/route.ts`: same shape as publish route, calls `runInsightsCycle()`.

`insights/actions.ts`: `refreshInsights(postId)` server action → `runInsightsCycle({ postId })`, revalidate, return `ActionResult`.

- [ ] **Step 3: UI** — on the post page show a small table per target (likes, comments, shares/saved, reach, fetched time) and a "Refresh insights" button; list rows show `♥ likes · 💬 comments` summed across targets when any insights exist.

- [ ] **Step 4: Test, commit** — `feat(insights): fetch and display post metrics`.

---

### Task 11: Dashboard tweaks and Playwright smoke

**Files:**
- Modify: `src/lib/dashboard/queries.ts` (+ `pending_approval_count`, `next_scheduled: { at, title } | null`), `src/app/(app)/dashboard/page.tsx`
- Create: `e2e/posts.spec.ts`

- [ ] **Step 1: Dashboard** — extend the per-brand query with a count of `posts.status='pending_approval'` and the earliest `post_targets.scheduled_at > now()` with status pending; show "2 awaiting approval · next: Sep 14, 3:40 PM Title".

- [ ] **Step 2: e2e**

```ts
import { test, expect } from "@playwright/test";
test("compose, submit, approve, calendar, recycle path", async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL, "no creds");
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  await page.goto("/posts/new");
  const title = `E2E post ${Date.now()}`;
  await page.getByLabel("Title (internal)").fill(title);
  await page.getByLabel("Instagram").uncheck();
  await page.locator("#cap-facebook").fill("Hello from e2e");
  await page.locator("#when-facebook").fill("2030-01-01T09:00");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/posts\/[0-9a-f-]+$/);
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Pending approval")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Scheduled").first()).toBeVisible();

  await page.goto("/calendar?month=2030-01");
  await expect(page.getByText(title.slice(0, 12))).toBeVisible();

  await page.goto(page.url().replace(/calendar.*/, "posts"));
  await page.getByRole("link", { name: title }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived")).toBeVisible();
});
```

- [ ] **Step 3: Run all checks, commit** — `npm run typecheck && npm run lint && npm test && npm run e2e`; `test(e2e): posts workflow smoke`.

---

### Task 12: Deploy, real publish verification, merge

- [ ] **Step 1:** Add `http://localhost:3000/api/auth/meta/callback` to the Meta app's Valid OAuth Redirect URIs (for local testing) — ask the user.
- [ ] **Step 2:** `npx vercel deploy --prod --yes`; confirm `/api/cron/publish` returns 401 without secret and 200 JSON with it (`curl -H "Authorization: Bearer $CRON_SECRET" -X POST https://jamsam-social.vercel.app/api/cron/publish`).
- [ ] **Step 3:** In production: Connect Facebook on the "JamSam Digital" brand (JamSam Lab or JamSam Digital Page) → green. Create a post with 2 library images, both platforms, scheduled 2 minutes out → approve → wait → both targets published with links; open them.
- [ ] **Step 4:** Check `select * from cron.job_run_details order by start_time desc limit 5` shows runs succeeding (status `succeeded`).
- [ ] **Step 5:** PR `phase-2-social-posts → main`, CI green, squash merge, confirm production.
