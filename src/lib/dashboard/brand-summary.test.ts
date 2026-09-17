import { describe, it, expect } from "vitest";
import { summariseNeedsYou, isOverdue, deriveHealthChecks, gscQueue, type NeedsYouInput, type HealthInput } from "@/lib/dashboard/brand-summary";

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
          { status: "pending", scheduled_at: ago(5), post_status: "approved" }, // not yet
          { status: "pending", scheduled_at: ago(30), post_status: "draft" }, // draft posts can't be overdue
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
