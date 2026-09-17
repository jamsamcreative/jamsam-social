# Brand Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/brands/[slug]` becomes a per-brand dashboard (Needs you → System health → Content quality → Submit to Search Console → freshness footer); the old Overview moves to `/brands/[slug]/settings`; `/dashboard` redirects to the current brand.

**Architecture:** Pure derivation functions in `src/lib/dashboard/brand-summary.ts` turn plain row shapes into a view model and are unit-tested without Supabase. `src/lib/dashboard/queries.ts` does all reads in one `Promise.all` and calls them. Four small components in `src/components/dashboard/` render the sections. A new nullable `articles.gsc_submitted_at` column backs the Search Console queue.

**Tech Stack:** Next.js App Router (read `node_modules/next/dist/docs/` before touching routing — this Next version differs from training data), React 19 server components + server actions, Supabase (Postgres), Tailwind + shadcn `Card`/`Badge`/`Button`, `sonner` toasts, vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-brand-dashboard-design.md`

## Global Constraints

- Overdue threshold: `scheduled_at` more than **15 minutes** in the past.
- Meta token expiry warns when `expires_at` is within **7 days** or already past.
- Content window: `MIX_WINDOW` (20) from `src/lib/ai/content-mix.ts`.
- Zero-state copy (verbatim): "Nothing publishes until you approve it", "Nothing failed or overdue", "Open Claude with the connector to write these", "across approvals, publishing, writing and SEO", "Nothing waiting — every pushed article has been submitted."
- `database.types.ts` is hand-maintained (see `type ArticleRow` at line ~37); add columns by hand, don't run `db:types`.
- Migrations apply with `npx supabase db push` (project is already linked). If the CLI isn't authenticated, stop and ask the user to run `npx supabase db push` themselves via `! npx supabase db push`.
- Existing `Connections / Guidelines / Content mix` URLs do not change.
- Run `npm test`, `npm run typecheck`, `npm run lint` before each commit that touches code.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0013_gsc_submitted.sql` | add `articles.gsc_submitted_at` |
| `src/lib/database.types.ts` | add the column to `ArticleRow` |
| `src/lib/articles/actions.ts` | `markSubmittedToSearchConsole`, `unmarkSubmittedToSearchConsole` |
| `src/components/articles/gsc-status.tsx` | "Submitted to Search Console <date> · Not submitted" line on the article page |
| `src/lib/time/relative.ts` (+test) | `relativeTime(iso, now)` → "12 min ago" |
| `src/lib/dashboard/brand-summary.ts` (+test) | pure: `summariseNeedsYou`, `deriveHealthChecks`, `gscQueue` |
| `src/lib/dashboard/queries.ts` | `getBrandDashboard(brand)` — replaces `getDashboardBrands` |
| `src/components/dashboard/needs-you.tsx` | big number + three tiles + scheduled |
| `src/components/dashboard/health-checks.tsx` | Checks card |
| `src/components/dashboard/content-quality.tsx` | mix bars |
| `src/components/dashboard/gsc-queue.tsx` | client: copy / done rows |
| `src/app/(app)/brands/[slug]/page.tsx` | dashboard page |
| `src/app/(app)/brands/[slug]/settings/page.tsx` | old overview |
| `src/app/(app)/brands/[slug]/brand-nav.tsx` | settings tabs |
| `src/app/(app)/dashboard/page.tsx` | redirect |
| `src/components/shell/brand-switcher.tsx` | path-aware navigation |

---

### Task 1: `gsc_submitted_at` column, actions, article-page indicator

**Files:**
- Create: `supabase/migrations/0013_gsc_submitted.sql`
- Modify: `src/lib/database.types.ts` (`type ArticleRow`, ~line 37–44)
- Modify: `src/lib/articles/actions.ts` (append two actions; change `refresh()`)
- Create: `src/components/articles/gsc-status.tsx`
- Modify: `src/app/(app)/blog/[id]/page.tsx`

**Interfaces:**
- Produces: `ArticleRow.gsc_submitted_at: string | null`; `markSubmittedToSearchConsole(id: string): Promise<ActionResult>`; `unmarkSubmittedToSearchConsole(id: string): Promise<ActionResult>` (both exported from `@/lib/articles/actions`, `ActionResult` already exported there).

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/0013_gsc_submitted.sql
-- Set when a person has pasted the article URL into Google Search Console and requested indexing.
alter table articles add column gsc_submitted_at timestamptz;
```

- [ ] **Step 2: Type**

In `src/lib/database.types.ts`, inside `type ArticleRow = { ... }`, after `last_error: string | null;` add:

```ts
  gsc_submitted_at: string | null;
```

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db push`
Expected: `Applying migration 0013_gsc_submitted.sql...` then `Finished supabase db push.` If it asks to log in, stop and ask the user to run it.

- [ ] **Step 4: Actions**

In `src/lib/articles/actions.ts`, change `refresh` so brand dashboards revalidate (the global `/dashboard` becomes a redirect in Task 8):

```ts
function refresh(id?: string) {
  revalidatePath("/blog");
  if (id) revalidatePath(`/blog/${id}`);
  revalidatePath("/brands/[slug]", "page");
}
```

Append at the end of the file:

```ts
async function setGscSubmitted(id: string, value: string | null): Promise<ActionResult> {
  const loaded = await load(id);
  if (loaded.error) return { ok: false, error: loaded.error };
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("articles").update({ gsc_submitted_at: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh(id);
  return { ok: true, id };
}

/** Dashboard "done": the person has requested indexing in Search Console. */
export async function markSubmittedToSearchConsole(id: string): Promise<ActionResult> {
  return setGscSubmitted(id, new Date().toISOString());
}

/** Article page reset for a mis-clicked "done". */
export async function unmarkSubmittedToSearchConsole(id: string): Promise<ActionResult> {
  return setGscSubmitted(id, null);
}
```

- [ ] **Step 5: Article page indicator**

Create `src/components/articles/gsc-status.tsx`:

```tsx
"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { unmarkSubmittedToSearchConsole } from "@/lib/articles/actions";

export function GscStatus({ articleId, submittedAt, formatted }: { articleId: string; submittedAt: string | null; formatted: string | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!submittedAt) return null;
  return (
    <span>
      {" "}· Submitted to Search Console {formatted}{" "}
      <button
        type="button"
        disabled={pending}
        className="underline disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const r = await unmarkSubmittedToSearchConsole(articleId);
            if (r.ok) {
              toast.success("Back in the Search Console queue");
              router.refresh();
            } else toast.error(r.error);
          })
        }
      >
        Not submitted
      </button>
    </span>
  );
}
```

In `src/app/(app)/blog/[id]/page.tsx` import it and render it inside the `<p className="text-sm text-muted-foreground">` block, after the `article.wp_link && (...)` fragment:

```tsx
import { GscStatus } from "@/components/articles/gsc-status";
...
            <GscStatus articleId={article.id} submittedAt={article.gsc_submitted_at} formatted={article.gsc_submitted_at ? formatInZone(article.gsc_submitted_at, brand.timezone) : null} />
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass (no new tests yet; typecheck confirms the column flows through `ArticleWithBrand`).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0013_gsc_submitted.sql src/lib/database.types.ts src/lib/articles/actions.ts src/components/articles/gsc-status.tsx "src/app/(app)/blog/[id]/page.tsx"
git commit -m "feat(articles): gsc_submitted_at with mark/unmark actions and article-page reset

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `relativeTime` helper

**Files:**
- Create: `src/lib/time/relative.ts`, `src/lib/time/relative.test.ts`

**Interfaces:**
- Produces: `relativeTime(iso: string, now?: Date): string` → `"just now" | "N min ago" | "N hr ago" | "N days ago"`; `daysUntil(iso: string, now?: Date): number` (floor, negative when past).

- [ ] **Step 1: Failing tests**

```ts
// src/lib/time/relative.test.ts
import { describe, it, expect } from "vitest";
import { relativeTime, daysUntil } from "@/lib/time/relative";

const now = new Date("2026-09-17T12:00:00Z");

describe("relativeTime", () => {
  it("under a minute is just now", () => expect(relativeTime("2026-09-17T11:59:40Z", now)).toBe("just now"));
  it("minutes", () => expect(relativeTime("2026-09-17T11:48:00Z", now)).toBe("12 min ago"));
  it("hours", () => expect(relativeTime("2026-09-17T09:00:00Z", now)).toBe("3 hr ago"));
  it("days, singular", () => expect(relativeTime("2026-09-16T11:00:00Z", now)).toBe("1 day ago"));
  it("days, plural", () => expect(relativeTime("2026-09-10T12:00:00Z", now)).toBe("7 days ago"));
});

describe("daysUntil", () => {
  it("future", () => expect(daysUntil("2026-09-24T12:00:00Z", now)).toBe(7));
  it("past is negative", () => expect(daysUntil("2026-09-15T12:00:00Z", now)).toBe(-2));
  it("floors partial days", () => expect(daysUntil("2026-09-18T06:00:00Z", now)).toBe(0));
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run src/lib/time/relative.test.ts`
Expected: FAIL — cannot resolve `@/lib/time/relative`.

- [ ] **Step 3: Implement**

```ts
// src/lib/time/relative.ts
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

export function relativeTime(iso: string, now = new Date()): string {
  const diff = now.getTime() - Date.parse(iso);
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} hr ago`;
  const d = Math.floor(diff / DAY);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function daysUntil(iso: string, now = new Date()): number {
  return Math.floor((Date.parse(iso) - now.getTime()) / DAY);
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run src/lib/time/relative.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/time/relative.ts src/lib/time/relative.test.ts
git commit -m "feat(time): relativeTime and daysUntil helpers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `summariseNeedsYou` (pure)

**Files:**
- Create: `src/lib/dashboard/brand-summary.ts`, `src/lib/dashboard/brand-summary.test.ts`

**Interfaces:**
- Produces (all exported from `@/lib/dashboard/brand-summary`):

```ts
export const OVERDUE_MS = 15 * 60_000;
export type NeedsYouInput = {
  posts: { status: string }[];                                              // all non-archived posts for the brand
  targets: { status: string; scheduled_at: string | null; post_status: string }[]; // post_targets joined to post.status
  pins: { status: string; scheduled_at: string | null }[];
  jobs: { status: string; runner: string }[];
  pendingLinks: number;
  failingConnections: number;
};
export type NeedsYou = {
  total: number;
  approval: { count: number; posts: number; pins: number; links: number };
  attention: { count: number; failed: number; overdue: number; connections: number };
  claude: { count: number; inProgress: number };
  scheduled: number;
};
export function summariseNeedsYou(input: NeedsYouInput, now?: Date): NeedsYou;
export function isOverdue(scheduledAt: string | null, now: Date): boolean;
```

- [ ] **Step 1: Failing tests**

```ts
// src/lib/dashboard/brand-summary.test.ts
import { describe, it, expect } from "vitest";
import { summariseNeedsYou, isOverdue, type NeedsYouInput } from "@/lib/dashboard/brand-summary";

const now = new Date("2026-09-17T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const ahead = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();
const empty: NeedsYouInput = { posts: [], targets: [], pins: [], jobs: [], pendingLinks: 0, failingConnections: 0 };

describe("isOverdue", () => {
  it("14 minutes late is not overdue, 16 is", () => {
    expect(isOverdue(ago(14), now)).toBe(false);
    expect(isOverdue(ago(16), now)).toBe(true);
  });
  it("null is never overdue", () => expect(isOverdue(null, now)).toBe(false));
});

describe("summariseNeedsYou", () => {
  it("all zero on empty input", () => {
    expect(summariseNeedsYou(empty, now)).toEqual({
      total: 0,
      approval: { count: 0, posts: 0, pins: 0, links: 0 },
      attention: { count: 0, failed: 0, overdue: 0, connections: 0 },
      claude: { count: 0, inProgress: 0 },
      scheduled: 0,
    });
  });

  it("approval = pending posts + pending pins + pending links", () => {
    const r = summariseNeedsYou({ ...empty, posts: [{ status: "pending_approval" }, { status: "draft" }], pins: [{ status: "pending_approval", scheduled_at: null }], pendingLinks: 3 }, now);
    expect(r.approval).toEqual({ count: 5, posts: 1, pins: 1, links: 3 });
  });

  it("attention = failed posts/pins/targets/jobs + overdue + failing connections", () => {
    const r = summariseNeedsYou(
      {
        posts: [{ status: "failed" }],
        targets: [
          { status: "failed", scheduled_at: ago(60), post_status: "failed" },
          { status: "pending", scheduled_at: ago(30), post_status: "approved" }, // overdue
          { status: "pending", scheduled_at: ago(5), post_status: "approved" },  // not yet
          { status: "pending", scheduled_at: ago(30), post_status: "draft" },    // draft posts can't be overdue
        ],
        pins: [{ status: "failed", scheduled_at: null }, { status: "approved", scheduled_at: ago(20) }],
        jobs: [{ status: "failed", runner: "in_app" }],
        pendingLinks: 0,
        failingConnections: 2,
      },
      now,
    );
    expect(r.attention).toEqual({ count: 8, failed: 4, overdue: 2, connections: 2 });
  });

  it("claude = queued mcp jobs; in-app queued jobs are not waiting on a person", () => {
    const r = summariseNeedsYou({ ...empty, jobs: [{ status: "queued", runner: "mcp" }, { status: "queued", runner: "in_app" }, { status: "running", runner: "mcp" }, { status: "claimed", runner: "mcp" }] }, now);
    expect(r.claude).toEqual({ count: 1, inProgress: 2 });
  });

  it("scheduled = future pending targets on approved posts + future approved pins", () => {
    const r = summariseNeedsYou(
      {
        ...empty,
        targets: [
          { status: "pending", scheduled_at: ahead(60), post_status: "approved" },
          { status: "pending", scheduled_at: ahead(60), post_status: "draft" },
          { status: "pending", scheduled_at: ago(60), post_status: "approved" },
        ],
        pins: [{ status: "approved", scheduled_at: ahead(10) }, { status: "approved", scheduled_at: null }],
      },
      now,
    );
    expect(r.scheduled).toBe(2);
  });

  it("total = approval + attention + claude", () => {
    const r = summariseNeedsYou({ ...empty, posts: [{ status: "pending_approval" }, { status: "failed" }], jobs: [{ status: "queued", runner: "mcp" }] }, now);
    expect(r.total).toBe(3);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run src/lib/dashboard/brand-summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/dashboard/brand-summary.ts
export const OVERDUE_MS = 15 * 60_000;

export type NeedsYouInput = {
  posts: { status: string }[];
  targets: { status: string; scheduled_at: string | null; post_status: string }[];
  pins: { status: string; scheduled_at: string | null }[];
  jobs: { status: string; runner: string }[];
  pendingLinks: number;
  failingConnections: number;
};

export type NeedsYou = {
  total: number;
  approval: { count: number; posts: number; pins: number; links: number };
  attention: { count: number; failed: number; overdue: number; connections: number };
  claude: { count: number; inProgress: number };
  scheduled: number;
};

export function isOverdue(scheduledAt: string | null, now: Date): boolean {
  return scheduledAt !== null && now.getTime() - Date.parse(scheduledAt) > OVERDUE_MS;
}

const isFuture = (at: string | null, now: Date) => at !== null && Date.parse(at) > now.getTime();
const LIVE_POST = new Set(["approved", "publishing"]);

export function summariseNeedsYou(input: NeedsYouInput, now = new Date()): NeedsYou {
  const pendingPosts = input.posts.filter((p) => p.status === "pending_approval").length;
  const pendingPins = input.pins.filter((p) => p.status === "pending_approval").length;
  const approval = { count: pendingPosts + pendingPins + input.pendingLinks, posts: pendingPosts, pins: pendingPins, links: input.pendingLinks };

  const failed =
    input.posts.filter((p) => p.status === "failed").length +
    input.pins.filter((p) => p.status === "failed").length +
    input.targets.filter((t) => t.status === "failed").length +
    input.jobs.filter((j) => j.status === "failed").length;
  const liveTargets = input.targets.filter((t) => t.status === "pending" && LIVE_POST.has(t.post_status));
  const approvedPins = input.pins.filter((p) => p.status === "approved");
  const overdue = liveTargets.filter((t) => isOverdue(t.scheduled_at, now)).length + approvedPins.filter((p) => isOverdue(p.scheduled_at, now)).length;
  const attention = { count: failed + overdue + input.failingConnections, failed, overdue, connections: input.failingConnections };

  const mcp = input.jobs.filter((j) => j.runner === "mcp");
  const claude = { count: mcp.filter((j) => j.status === "queued").length, inProgress: mcp.filter((j) => j.status === "claimed" || j.status === "running").length };

  const scheduled = liveTargets.filter((t) => t.post_status === "approved" && isFuture(t.scheduled_at, now)).length + approvedPins.filter((p) => isFuture(p.scheduled_at, now)).length;

  return { total: approval.count + attention.count + claude.count, approval, attention, claude, scheduled };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run src/lib/dashboard/brand-summary.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/brand-summary.ts src/lib/dashboard/brand-summary.test.ts
git commit -m "feat(dashboard): summariseNeedsYou — approval, attention, waiting-on-Claude, scheduled

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `deriveHealthChecks` and `gscQueue` (pure)

**Files:**
- Modify: `src/lib/dashboard/brand-summary.ts`, `src/lib/dashboard/brand-summary.test.ts`

**Interfaces:**
- Consumes: `relativeTime`, `daysUntil` from `@/lib/time/relative`; `PROVIDER_LABELS`, `Provider` from `@/lib/connections/types`; `isOverdue` from Task 3.
- Produces:

```ts
export type CheckState = "ok" | "pending" | "warn";
export type HealthCheck = { key: string; state: CheckState; label: string; detail: string; href?: string };
export type HealthInput = {
  slug: string;
  providers: Provider[];                       // PROVIDER_ORDER (+ "gbp" when enabled)
  connections: { provider: string; status: string; last_checked: string | null; last_error: string | null }[];
  metaExpiresAt: string | null;                // from the decrypted meta secret, if any
  overdue: number;
  lastPublishedAt: string | null;              // max published_at across post_targets and pins
  syncRuns: { source: string; last_ok_at: string | null; last_error: string | null }[];
};
export type Health = { checks: HealthCheck[]; allGood: boolean };
export function deriveHealthChecks(input: HealthInput, now?: Date): Health;

export type GscArticle = { id: string; title: string; status: string; wp_link: string | null; pushed_at: string | null; gsc_submitted_at: string | null };
export function gscQueue<T extends GscArticle>(articles: T[]): T[];
```

- [ ] **Step 1: Failing tests** (append to the test file)

```ts
import { deriveHealthChecks, gscQueue, type HealthInput } from "@/lib/dashboard/brand-summary";

const health: HealthInput = { slug: "ssa", providers: ["wordpress", "meta"], connections: [], metaExpiresAt: null, overdue: 0, lastPublishedAt: null, syncRuns: [] };
const check = (i: HealthInput, key: string) => deriveHealthChecks(i, now).checks.find((c) => c.key === key)!;

describe("deriveHealthChecks", () => {
  it("publisher ok with nothing scheduled", () => {
    expect(check(health, "publisher")).toMatchObject({ state: "ok", label: "Publisher", detail: "nothing scheduled yet" });
  });
  it("publisher ok shows last published relative time", () => {
    expect(check({ ...health, lastPublishedAt: ago(12) }, "publisher").detail).toBe("last published 12 min ago");
  });
  it("publisher warns on overdue", () => {
    expect(check({ ...health, overdue: 2 }, "publisher")).toMatchObject({ state: "warn", detail: "2 items overdue" });
  });
  it("missing provider is pending with its consequence and links to connections", () => {
    expect(check(health, "wordpress")).toMatchObject({ state: "pending", label: "WordPress", detail: "Not connected — blog can't publish", href: "/brands/ssa/connections" });
    expect(check(health, "meta").detail).toBe("Not connected — drafts only");
  });
  it("connected provider is ok with checked time", () => {
    const i = { ...health, connections: [{ provider: "wordpress", status: "connected", last_checked: ago(60), last_error: null }] };
    expect(check(i, "wordpress")).toMatchObject({ state: "ok", detail: "Connected — checked 1 hr ago" });
  });
  it("failing provider warns with its error", () => {
    const i = { ...health, connections: [{ provider: "wordpress", status: "failing", last_checked: ago(60), last_error: "401 from WP" }] };
    expect(check(i, "wordpress")).toMatchObject({ state: "warn", detail: "Failing — 401 from WP" });
  });
  it("meta expiry 8 days out is ok with the date; 6 days warns; past warns", () => {
    const conn = [{ provider: "meta", status: "connected", last_checked: ago(1), last_error: null }];
    expect(check({ ...health, connections: conn, metaExpiresAt: "2026-09-25T12:00:00Z" }, "meta")).toMatchObject({ state: "ok", detail: "Connected — checked 1 min ago — data access good through Sep 25, 2026" });
    expect(check({ ...health, connections: conn, metaExpiresAt: "2026-09-23T12:00:00Z" }, "meta")).toMatchObject({ state: "warn", detail: "Connected — data access expires in 6 days (Sep 23, 2026) — reconnect Meta" });
    expect(check({ ...health, connections: conn, metaExpiresAt: "2026-09-01T12:00:00Z" }, "meta")).toMatchObject({ state: "warn", detail: "Connected — data access expired Sep 1, 2026 — reconnect Meta" });
  });
  it("sync rows: ok with last ok time, warn with error; none when no runs", () => {
    expect(deriveHealthChecks(health, now).checks.some((c) => c.key.startsWith("sync:"))).toBe(false);
    const i = { ...health, syncRuns: [{ source: "google_analytics", last_ok_at: ago(600), last_error: null }, { source: "search_console", last_ok_at: null, last_error: "quota" }] };
    expect(check(i, "sync:google_analytics")).toMatchObject({ state: "ok", label: "Google Analytics 4 sync", detail: "last ok 10 hr ago" });
    expect(check(i, "sync:search_console")).toMatchObject({ state: "warn", label: "Google Search Console sync", detail: "quota" });
  });
  it("allGood only when every row is ok", () => {
    const conn = [{ provider: "wordpress", status: "connected", last_checked: ago(1), last_error: null }, { provider: "meta", status: "connected", last_checked: ago(1), last_error: null }];
    expect(deriveHealthChecks({ ...health, connections: conn }, now).allGood).toBe(true);
    expect(deriveHealthChecks(health, now).allGood).toBe(false);
  });
});

describe("gscQueue", () => {
  const a = (o: Partial<Parameters<typeof gscQueue>[0][number]>) => ({ id: "x", title: "t", status: "published", wp_link: "https://s/x/", pushed_at: "2026-09-10T00:00:00Z", gsc_submitted_at: null, ...o });
  it("keeps pushed/published articles with a link that are not yet submitted", () => {
    expect(gscQueue([a({ id: "1" }), a({ id: "2", status: "pushed_to_wp" })]).map((x) => x.id)).toEqual(["1", "2"]);
  });
  it("excludes drafts, archived, missing links, and submitted", () => {
    expect(gscQueue([a({ status: "draft" }), a({ status: "archived" }), a({ wp_link: null }), a({ gsc_submitted_at: "2026-09-11T00:00:00Z" })])).toEqual([]);
  });
  it("orders newest push first, null pushed_at last", () => {
    const r = gscQueue([a({ id: "old", pushed_at: "2026-09-01T00:00:00Z" }), a({ id: "none", pushed_at: null }), a({ id: "new", pushed_at: "2026-09-15T00:00:00Z" })]);
    expect(r.map((x) => x.id)).toEqual(["new", "old", "none"]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run src/lib/dashboard/brand-summary.test.ts`
Expected: FAIL — `deriveHealthChecks is not a function`.

- [ ] **Step 3: Implement** (append to `brand-summary.ts`)

```ts
import { relativeTime, daysUntil } from "@/lib/time/relative";
import { PROVIDER_LABELS, type Provider } from "@/lib/connections/types";

export type CheckState = "ok" | "pending" | "warn";
export type HealthCheck = { key: string; state: CheckState; label: string; detail: string; href?: string };
export type HealthInput = {
  slug: string;
  providers: Provider[];
  connections: { provider: string; status: string; last_checked: string | null; last_error: string | null }[];
  metaExpiresAt: string | null;
  overdue: number;
  lastPublishedAt: string | null;
  syncRuns: { source: string; last_ok_at: string | null; last_error: string | null }[];
};
export type Health = { checks: HealthCheck[]; allGood: boolean };

/** What you lose while a provider is not connected. */
const NOT_CONNECTED: Record<Provider, string> = {
  wordpress: "blog can't publish",
  meta: "drafts only",
  meta_ads: "no ad metrics",
  google_analytics: "no traffic data",
  search_console: "no search data",
  pinterest: "pins stay drafts",
  semrush: "keyword data from CSV/GSC only",
  gbp: "no Google posts",
};
export const EXPIRY_WARN_DAYS = 7;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function metaExpiry(expiresAt: string, now: Date): { state: CheckState; suffix: string } {
  const days = daysUntil(expiresAt, now);
  if (days < 0) return { state: "warn", suffix: ` — data access expired ${shortDate(expiresAt)} — reconnect Meta` };
  if (days <= EXPIRY_WARN_DAYS) return { state: "warn", suffix: ` — data access expires in ${days} day${days === 1 ? "" : "s"} (${shortDate(expiresAt)}) — reconnect Meta` };
  return { state: "ok", suffix: ` — data access good through ${shortDate(expiresAt)}` };
}

export function deriveHealthChecks(input: HealthInput, now = new Date()): Health {
  const checks: HealthCheck[] = [];
  const connectionsHref = `/brands/${input.slug}/connections`;

  if (input.overdue > 0) checks.push({ key: "publisher", state: "warn", label: "Publisher", detail: `${input.overdue} item${input.overdue === 1 ? "" : "s"} overdue`, href: "/calendar" });
  else checks.push({ key: "publisher", state: "ok", label: "Publisher", detail: input.lastPublishedAt ? `last published ${relativeTime(input.lastPublishedAt, now)}` : "nothing scheduled yet" });

  for (const p of input.providers) {
    const c = input.connections.find((x) => x.provider === p);
    const label = PROVIDER_LABELS[p];
    if (!c || c.status === "not_connected") {
      checks.push({ key: p, state: "pending", label, detail: `Not connected — ${NOT_CONNECTED[p]}`, href: connectionsHref });
    } else if (c.status === "failing") {
      checks.push({ key: p, state: "warn", label, detail: `Failing — ${c.last_error ?? "unknown error"}`, href: connectionsHref });
    } else {
      const checked = c.last_checked ? `checked ${relativeTime(c.last_checked, now)}` : "not checked yet";
      if (p === "meta" && input.metaExpiresAt) {
        const e = metaExpiry(input.metaExpiresAt, now);
        checks.push({ key: p, state: e.state, label, detail: e.state === "ok" ? `Connected — ${checked}${e.suffix}` : `Connected${e.suffix}`, href: connectionsHref });
      } else {
        checks.push({ key: p, state: "ok", label, detail: `Connected — ${checked}`, href: connectionsHref });
      }
    }
  }

  for (const s of input.syncRuns) {
    const label = `${PROVIDER_LABELS[s.source as Provider] ?? s.source} sync`;
    if (s.last_error) checks.push({ key: `sync:${s.source}`, state: "warn", label, detail: s.last_error, href: "/reports" });
    else checks.push({ key: `sync:${s.source}`, state: "ok", label, detail: s.last_ok_at ? `last ok ${relativeTime(s.last_ok_at, now)}` : "not run yet", href: "/reports" });
  }

  return { checks, allGood: checks.every((c) => c.state === "ok") };
}

export type GscArticle = { id: string; title: string; status: string; wp_link: string | null; pushed_at: string | null; gsc_submitted_at: string | null };

/** Articles the app pushed to WordPress that nobody has yet submitted to Search Console. Newest push first. */
export function gscQueue<T extends GscArticle>(articles: T[]): T[] {
  return articles
    .filter((a) => a.wp_link && (a.status === "pushed_to_wp" || a.status === "published") && !a.gsc_submitted_at)
    .sort((a, b) => (b.pushed_at ?? "") .localeCompare(a.pushed_at ?? ""));
}
```

Check `PROVIDER_LABELS` in `src/lib/connections/types.ts` includes `gbp` and that its values are the display names used in tests ("WordPress", "Google Analytics", "Search Console"). Labels are "WordPress", "Meta (Facebook + Instagram)", "Google Analytics 4", "Google Search Console" — the tests above use those.

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run src/lib/dashboard/brand-summary.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/brand-summary.ts src/lib/dashboard/brand-summary.test.ts
git commit -m "feat(dashboard): deriveHealthChecks and gscQueue

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `getBrandDashboard` query

**Files:**
- Rewrite: `src/lib/dashboard/queries.ts`

**Interfaces:**
- Consumes: Task 3/4 functions; `listConnectionsForBrand`, `getConnectionWithSecret` (`@/lib/connections/queries`); `MetaConfig`, `MetaSecret` (`@/lib/connections/meta`); `PROVIDER_ORDER` (`@/lib/connections`); `env` (`@/lib/env`); `listCategories` (`@/lib/categories/queries`); `computeContentMix`, `ContentMix` (`@/lib/ai/content-mix`); `createSupabaseStore().listRecentCategorizedPosts` (`@/lib/ai/store`); `createSupabaseLinksStore().counts(brandId)` (`@/lib/links/store`); `listImportsForBrand` (`@/lib/seo/queries`); `dataFreshness` (`@/lib/seo/freshness`); `Brand` (`@/lib/brands/queries`).
- Produces:

```ts
export type BrandDashboard = {
  needs: NeedsYou;
  health: Health;
  mix: ContentMix;
  gsc: { id: string; title: string; wp_link: string }[];
  freshness: ReturnType<typeof dataFreshness>;
};
export async function getBrandDashboard(brand: Brand): Promise<BrandDashboard>;
```

- [ ] **Step 1: Replace the file**

```ts
// src/lib/dashboard/queries.ts
import { createServerSupabase } from "@/lib/supabase/server";
import type { Brand } from "@/lib/brands/queries";
import { PROVIDER_ORDER } from "@/lib/connections";
import { listConnectionsForBrand, getConnectionWithSecret } from "@/lib/connections/queries";
import type { MetaConfig, MetaSecret } from "@/lib/connections/meta";
import { env } from "@/lib/env";
import { listCategories } from "@/lib/categories/queries";
import { computeContentMix, type ContentMix } from "@/lib/ai/content-mix";
import { createSupabaseStore } from "@/lib/ai/store";
import { createSupabaseLinksStore } from "@/lib/links/store";
import { listImportsForBrand } from "@/lib/seo/queries";
import { dataFreshness } from "@/lib/seo/freshness";
import { summariseNeedsYou, deriveHealthChecks, gscQueue, type NeedsYou, type Health } from "./brand-summary";

export type BrandDashboard = {
  needs: NeedsYou;
  health: Health;
  mix: ContentMix;
  gsc: { id: string; title: string; wp_link: string }[];
  freshness: ReturnType<typeof dataFreshness>;
};

export async function getBrandDashboard(brand: Brand): Promise<BrandDashboard> {
  const supabase = await createServerSupabase();
  const now = new Date();
  const [posts, targets, pins, jobs, links, connections, meta, syncRuns, articles, categories, recent, imports] = await Promise.all([
    supabase.from("posts").select("status").eq("brand_id", brand.id).neq("status", "archived"),
    supabase.from("post_targets").select("status,scheduled_at,published_at,post:posts!inner(brand_id,status)").eq("post.brand_id", brand.id),
    supabase.from("pins").select("status,scheduled_at,published_at").eq("brand_id", brand.id).neq("status", "archived"),
    supabase.from("generation_jobs").select("status,runner").eq("brand_id", brand.id).in("status", ["queued", "claimed", "running", "failed"]),
    createSupabaseLinksStore().counts(brand.id),
    listConnectionsForBrand(brand.id),
    getConnectionWithSecret<MetaConfig, MetaSecret>(brand.id, "meta").catch(() => null),
    supabase.from("sync_runs").select("source,last_ok_at,last_error").eq("brand_id", brand.id),
    supabase.from("articles").select("id,title,status,wp_link,pushed_at,gsc_submitted_at").eq("brand_id", brand.id).in("status", ["pushed_to_wp", "published"]),
    listCategories(brand.id),
    createSupabaseStore().listRecentCategorizedPosts(brand.id),
    listImportsForBrand(brand.id),
  ]);
  for (const r of [posts, targets, pins, jobs, syncRuns, articles]) if (r.error) throw new Error(r.error.message);

  type TargetRow = { status: string; scheduled_at: string | null; published_at: string | null; post: { brand_id: string; status: string } };
  const targetRows = (targets.data ?? []) as unknown as TargetRow[];
  const failingConnections = connections.filter((c) => c.status === "failing").length;

  const needs = summariseNeedsYou(
    {
      posts: posts.data ?? [],
      targets: targetRows.map((t) => ({ status: t.status, scheduled_at: t.scheduled_at, post_status: t.post.status })),
      pins: pins.data ?? [],
      jobs: jobs.data ?? [],
      pendingLinks: links.pending,
      failingConnections,
    },
    now,
  );

  const publishedAts = [...targetRows.map((t) => t.published_at), ...(pins.data ?? []).map((p) => p.published_at)].filter((x): x is string => Boolean(x)).sort();
  const health = deriveHealthChecks(
    {
      slug: brand.slug,
      providers: [...PROVIDER_ORDER, ...(env.GBP_ENABLED === "true" ? (["gbp"] as const) : [])],
      connections,
      metaExpiresAt: meta?.secret.expires_at ?? null,
      overdue: needs.attention.overdue,
      lastPublishedAt: publishedAts.at(-1) ?? null,
      syncRuns: syncRuns.data ?? [],
    },
    now,
  );

  const mix = computeContentMix(categories, recent);
  const gsc = gscQueue(articles.data ?? []).map((a) => ({ id: a.id, title: a.title, wp_link: a.wp_link! }));

  return { needs, health, mix, gsc, freshness: dataFreshness(imports, now) };
}
```


- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: the only errors are in `src/app/(app)/dashboard/page.tsx` (still imports `getDashboardBrands`). That page is replaced in Task 8; to keep this commit green, temporarily change its body to:

```tsx
import { redirect } from "next/navigation";
export default function DashboardPage() { redirect("/brands"); }
```

Then `npm run typecheck && npm run lint` pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboard/queries.ts "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(dashboard): getBrandDashboard query; retire the all-brands grid

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Dashboard section components

**Files:**
- Create: `src/components/dashboard/needs-you.tsx`, `health-checks.tsx`, `content-quality.tsx`, `gsc-queue.tsx`

**Interfaces:**
- Consumes: `NeedsYou`, `Health`, `HealthCheck` from `@/lib/dashboard/brand-summary`; `ContentMix` from `@/lib/ai/content-mix`; `markSubmittedToSearchConsole` from `@/lib/articles/actions`.
- Produces: `<NeedsYouSection needs slug />`, `<HealthChecks health />`, `<ContentQuality mix slug />`, `<GscQueue items websiteUrl />`.

- [ ] **Step 1: needs-you.tsx** (server component)

```tsx
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import type { NeedsYou } from "@/lib/dashboard/brand-summary";

function Tile({ title, count, sub, href }: { title: string; count: number; sub: string; href: string }) {
  return (
    <Link href={href} className="block">
      <Card className="h-full transition-colors hover:bg-muted/40">
        <CardContent className="space-y-1 p-4">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-3xl font-semibold tabular-nums">{count}</p>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function NeedsYouSection({ needs, slug }: { needs: NeedsYou; slug: string }) {
  const { approval, attention, claude } = needs;
  const approvalSub = approval.count === 0 ? "Nothing publishes until you approve it" : [approval.posts && plural(approval.posts, "post"), approval.pins && plural(approval.pins, "pin"), approval.links && plural(approval.links, "internal link")].filter(Boolean).join(" · ");
  const attentionSub = attention.count === 0 ? "Nothing failed or overdue" : [attention.failed && `${attention.failed} failed`, attention.overdue && `${attention.overdue} overdue`, attention.connections && plural(attention.connections, "failing connection")].filter(Boolean).join(" · ");
  const claudeSub = claude.count === 0 ? (claude.inProgress ? `${claude.inProgress} in progress` : "Open Claude with the connector to write these") : `Open Claude with the connector to write these${claude.inProgress ? ` · ${claude.inProgress} in progress` : ""}`;
  const approvalHref = approval.links > 0 && approval.posts === 0 && approval.pins === 0 ? "/blog/links" : approval.pins > 0 && approval.posts === 0 ? "/pins?status=pending" : "/posts?status=pending";
  const attentionHref = attention.connections > 0 && attention.failed === 0 && attention.overdue === 0 ? `/brands/${slug}/connections` : attention.overdue > 0 && attention.failed === 0 ? "/calendar" : "/jobs";

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Needs you</h2>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <span className="text-5xl font-bold tabular-nums">{needs.total}</span>
            <div>
              <p className="font-medium">Open items</p>
              <p className="text-sm text-muted-foreground">across approvals, publishing, writing and SEO</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-semibold tabular-nums">{needs.scheduled}</span>
            <div className="text-sm">
              <p>approved and scheduled</p>
              <Link href="/calendar" className="text-xs underline">See the calendar →</Link>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Tile title="Awaiting approval" count={approval.count} sub={approvalSub} href={approvalHref} />
        <Tile title="Needs attention" count={attention.count} sub={attentionSub} href={attentionHref} />
        <Tile title="Waiting on Claude" count={claude.count} sub={claudeSub} href="/jobs" />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: health-checks.tsx** (server component)

```tsx
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Health, HealthCheck } from "@/lib/dashboard/brand-summary";

const ICON: Record<HealthCheck["state"], { glyph: string; className: string }> = {
  ok: { glyph: "✓", className: "text-green-600" },
  pending: { glyph: "◷", className: "text-muted-foreground" },
  warn: { glyph: "⚠", className: "text-amber-600" },
};

export function HealthChecks({ health }: { health: Health }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">System health</h2>
        <p className="text-sm text-muted-foreground">Background jobs nobody watches. All green means you can trust the numbers above.</p>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm uppercase tracking-wide">Checks</CardTitle>
          {health.allGood ? <Badge className="bg-green-600 text-white hover:bg-green-600">All good</Badge> : <Badge variant="outline" className="border-amber-600 text-amber-700">⚠ Needs a look</Badge>}
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {health.checks.map((c) => {
              const icon = ICON[c.state];
              const row = (
                <>
                  <span className={cn("w-5 shrink-0", icon.className)} aria-label={c.state}>{icon.glyph}</span>
                  <span className="font-medium">{c.label}</span>
                  <span className={cn("text-muted-foreground", c.state === "warn" && "text-amber-700")}>{c.detail}</span>
                </>
              );
              return (
                <li key={c.key} className="py-2">
                  {c.href ? <Link href={c.href} className="flex items-center gap-2 hover:underline">{row}</Link> : <div className="flex items-center gap-2">{row}</div>}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
```

- [ ] **Step 3: content-quality.tsx** (server component)

```tsx
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ContentMix } from "@/lib/ai/content-mix";

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function ContentQuality({ mix, slug }: { mix: ContentMix; slug: string }) {
  const next = mix.categories.find((c) => c.slug === mix.favour_next);
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Content quality</h2>
        <p className="text-sm text-muted-foreground">
          Mix adherence: the share of the last {mix.window} approved/published posts in each category versus its target. Counted from what actually went out. This drives what Claude is told to write next — it is not a measure of writing quality or engagement.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide">Category mix · last {mix.total} of {mix.window}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {mix.categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No categories yet — <Link href={`/brands/${slug}/content-mix`} className="underline">set targets in Settings → Content mix</Link>.
            </p>
          ) : (
            <>
              {mix.categories.map((c) => (
                <div key={c.id} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground">{pct(c.actual_share)} of the last {mix.total} · target {pct(c.target_share)}</span>
                  </div>
                  <div className="relative h-2 rounded bg-muted">
                    <div className="h-2 rounded bg-primary" style={{ width: pct(Math.min(c.actual_share, 1)) }} />
                    <div className="absolute top-[-2px] h-3 w-0.5 bg-foreground" style={{ left: pct(Math.min(c.target_share, 1)) }} aria-label={`target ${pct(c.target_share)}`} />
                  </div>
                </div>
              ))}
              {next && (
                <p className="text-sm text-muted-foreground">
                  Target is the tick. Next post: <span className="font-medium text-foreground">{next.name}</span> — furthest under target.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
```

- [ ] **Step 4: gsc-queue.tsx** (client component)

```tsx
"use client";
import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { markSubmittedToSearchConsole } from "@/lib/articles/actions";

export type GscItem = { id: string; title: string; wp_link: string };

export function GscQueue({ items, websiteUrl }: { items: GscItem[]; websiteUrl: string | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [visible, hide] = useOptimistic(items, (state, id: string) => state.filter((i) => i.id !== id));
  const consoleUrl = websiteUrl ? `https://search.google.com/search-console?resource_id=${encodeURIComponent(websiteUrl)}` : null;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy — select the URL instead");
    }
  };
  const done = (id: string) =>
    start(async () => {
      hide(id);
      const r = await markSubmittedToSearchConsole(id);
      if (r.ok) router.refresh();
      else toast.error(r.error);
    });

  return (
    <section className="space-y-3">
      <Card>
        <CardHeader className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm uppercase tracking-wide">Submit to Search Console ({visible.length})</CardTitle>
            {consoleUrl && (
              <a href={consoleUrl} target="_blank" rel="noreferrer" className="text-sm underline">
                open Search Console →
              </a>
            )}
          </div>
          <p className="text-sm text-muted-foreground">Copy a URL, paste it into the URL inspection bar in Search Console, click <b>Request indexing</b>, then mark it Done here.</p>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting — every pushed article has been submitted.</p>
          ) : (
            <ul className="divide-y text-sm">
              {visible.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-1.5">
                  <a href={i.wp_link} target="_blank" rel="noreferrer" className="truncate hover:underline" title={i.title}>
                    {i.wp_link}
                  </a>
                  <span className="flex shrink-0 gap-3 text-xs">
                    <button type="button" className="underline" onClick={() => copy(i.wp_link)}>copy</button>
                    <button type="button" className="underline disabled:opacity-50" disabled={pending} onClick={() => done(i.id)}>done</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: pass. If `useOptimistic` complains that `hide` is called outside a transition, it is inside `start(...)` — keep it there.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard
git commit -m "feat(dashboard): needs-you, health-checks, content-quality and gsc-queue sections

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Settings page + settings tab strip

**Files:**
- Create: `src/app/(app)/brands/[slug]/settings/page.tsx` (content moved from the current `[slug]/page.tsx`)
- Modify: `src/app/(app)/brands/[slug]/brand-nav.tsx`
- Modify: `src/app/(app)/brands/[slug]/connections/page.tsx`, `guidelines/page.tsx`, `content-mix/page.tsx` (heading only)

- [ ] **Step 1: Settings page**

Create `src/app/(app)/brands/[slug]/settings/page.tsx` with the **entire current body** of `src/app/(app)/brands/[slug]/page.tsx`, with these edits: rename the component to `BrandSettingsPage`, add `export const metadata = { title: "Brand settings" };`, and change the `<h1>` line to render `{brand.name} <span className="text-muted-foreground">· Settings</span>`. Everything else (Edit/Archive buttons, `<BrandNav />`, the `<dl>`, the posting schedule card) stays.

- [ ] **Step 2: Tab strip**

Replace the `tabs` array in `brand-nav.tsx`:

```ts
  const tabs = [
    { href: `/brands/${slug}/settings`, label: "General" },
    { href: `/brands/${slug}/connections`, label: "Connections" },
    { href: `/brands/${slug}/guidelines`, label: "Guidelines" },
    { href: `/brands/${slug}/content-mix`, label: "Content mix" },
  ];
```

and add a "← Dashboard" link at the left of the nav:

```tsx
    <nav className="flex items-center gap-1 border-b">
      <Link href={`/brands/${slug}`} className="mr-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground">← Dashboard</Link>
      {tabs.map((t) => ( ...unchanged... ))}
    </nav>
```

- [ ] **Step 3: Sub-page headings**

In `connections/page.tsx`, `guidelines/page.tsx`, `content-mix/page.tsx` change the `<h1>` to:

```tsx
<h1 className="text-2xl font-semibold">{brand.name} <span className="text-muted-foreground">· Settings</span></h1>
```

(`content-mix/page.tsx` already has `brand` in scope.)

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/brands/[slug]"
git commit -m "feat(brands): per-brand Settings page and settings tab strip

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Dashboard page, `/dashboard` redirect, brand switcher, revalidation paths

**Files:**
- Rewrite: `src/app/(app)/brands/[slug]/page.tsx`
- Rewrite: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/components/shell/brand-switcher.tsx`
- Modify: `revalidatePath("/dashboard")` in `src/lib/pins/actions.ts:35`, `src/lib/posts/actions.ts:41`, `src/lib/plan/actions.ts:25`, `src/lib/brands/actions.ts:46`, `src/lib/meta/actions.ts:28`, `src/lib/connections/actions.ts:112`, `src/lib/jobs/actions.ts:14`

- [ ] **Step 1: Dashboard page**

```tsx
// src/app/(app)/brands/[slug]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands/queries";
import { getBrandDashboard } from "@/lib/dashboard/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NeedsYouSection } from "@/components/dashboard/needs-you";
import { HealthChecks } from "@/components/dashboard/health-checks";
import { ContentQuality } from "@/components/dashboard/content-quality";
import { GscQueue } from "@/components/dashboard/gsc-queue";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function BrandDashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const d = await getBrandDashboard(brand);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{brand.name}</h1>
            {!brand.active && <Badge variant="secondary">Archived</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">What needs a person right now, then whether the machinery behind it is healthy.</p>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href={`/brands/${brand.slug}/settings`} />}>
          Settings
        </Button>
      </div>
      <NeedsYouSection needs={d.needs} slug={brand.slug} />
      <HealthChecks health={d.health} />
      <ContentQuality mix={d.mix} slug={brand.slug} />
      <GscQueue items={d.gsc} websiteUrl={brand.website_url} />
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className={cn("inline-block h-2 w-2 rounded-full", d.freshness.stale ? "bg-amber-500" : "bg-green-500")} />
        {d.freshness.note}{" "}
        <Link href="/seo?tab=imports" className="underline">Upload a new export</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: `/dashboard` redirect**

```tsx
// src/app/(app)/dashboard/page.tsx
import { redirect } from "next/navigation";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";

export default async function DashboardPage() {
  const [brands, current] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === current) ?? brands[0];
  redirect(brand ? `/brands/${brand.slug}` : "/brands/new");
}
```

- [ ] **Step 3: Brand switcher navigates within `/brands/<slug>/...`**

In `src/components/shell/brand-switcher.tsx`:

```tsx
"use client";
import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setCurrentBrand } from "@/lib/current-brand";
import type { Brand } from "@/lib/brands/queries";

/** On a brand page, switching brands goes to the same sub-page for the new brand; elsewhere the page just re-renders. */
export function brandSwitchTarget(pathname: string, newSlug: string): string | null {
  const m = pathname.match(/^\/brands\/([^/]+)(\/.*)?$/);
  if (!m || m[1] === "new") return null;
  return `/brands/${newSlug}${m[2] ?? ""}`;
}

export function BrandSwitcher({ brands, current }: { brands: Brand[]; current: string | null }) {
  const [pending, start] = useTransition();
  const pathname = usePathname();
  const router = useRouter();
  if (brands.length === 0) return <span className="text-sm text-muted-foreground">No brands yet</span>;
  return (
    <Select
      value={current ?? undefined}
      onValueChange={(slug) =>
        slug &&
        start(async () => {
          await setCurrentBrand(slug);
          const target = brandSwitchTarget(pathname, slug);
          if (target) router.push(target);
        })
      }
      disabled={pending}
      items={brands.map((b) => ({ value: b.slug, label: b.name }))}
    >
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Select a brand">{(value: string | null) => brands.find((b) => b.slug === value)?.name ?? "Select a brand"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {brands.map((b) => (
          <SelectItem key={b.id} value={b.slug}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

Add `src/components/shell/brand-switcher.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { brandSwitchTarget } from "@/components/shell/brand-switcher";

describe("brandSwitchTarget", () => {
  it("dashboard → dashboard", () => expect(brandSwitchTarget("/brands/ssa", "kit")).toBe("/brands/kit"));
  it("keeps the sub-page", () => expect(brandSwitchTarget("/brands/ssa/settings", "kit")).toBe("/brands/kit/settings"));
  it("keeps nested pages", () => expect(brandSwitchTarget("/brands/ssa/connections/meta/pick", "kit")).toBe("/brands/kit/connections/meta/pick"));
  it("stays put elsewhere", () => {
    expect(brandSwitchTarget("/seo", "kit")).toBeNull();
    expect(brandSwitchTarget("/brands", "kit")).toBeNull();
    expect(brandSwitchTarget("/brands/new", "kit")).toBeNull();
  });
});
```

If vitest fails to import the component file because of the `"use client"` + Select imports in a node environment, move `brandSwitchTarget` to `src/components/shell/brand-switch-target.ts` (plain module), import it from the component, and point the test at that file.

- [ ] **Step 4: Revalidation paths**

In each of the seven files listed above replace `revalidatePath("/dashboard");` with `revalidatePath("/brands/[slug]", "page");`.

Run: `grep -rn 'revalidatePath("/dashboard")' src` — expected: no output.

- [ ] **Step 5: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/brands/[slug]/page.tsx" "src/app/(app)/dashboard/page.tsx" src/components/shell src/lib/pins/actions.ts src/lib/posts/actions.ts src/lib/plan/actions.ts src/lib/brands/actions.ts src/lib/meta/actions.ts src/lib/connections/actions.ts src/lib/jobs/actions.ts
git commit -m "feat(dashboard): per-brand dashboard page; /dashboard redirects to the current brand

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Browser check against the screenshot

**Files:** none (fixes go into the files above).

- [ ] **Step 1: Run the app**

Run: `npm run dev` in the background, then open `http://localhost:3000/dashboard` in the browser (sign in if needed). Expected: redirect to `/brands/<current>`.

- [ ] **Step 2: Compare with the screenshot**

Check, top to bottom: header + Settings button; Needs you big number + right-hand scheduled count + three tiles with the zero-state copy; Checks card with All good / Needs a look badge and one row per provider; Content quality bars with target ticks and "Next post"; Submit to Search Console card with copy/done and the how-to line; freshness footer.

- [ ] **Step 3: Exercise the queue**

Click **copy** on a row → "Copied" toast. Click **done** → row disappears, count decrements. Open that article's `/blog/[id]` page → "Submitted to Search Console <date> · Not submitted"; click **Not submitted** → back on the dashboard.

- [ ] **Step 4: Switcher**

On `/brands/<a>/settings` pick brand B in the header → lands on `/brands/<b>/settings`. On `/seo` pick brand A → stays on `/seo`.

- [ ] **Step 5: Fix anything off, rerun `npm test && npm run typecheck && npm run lint`, commit**

```bash
git commit -am "fix(dashboard): polish from browser check

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
