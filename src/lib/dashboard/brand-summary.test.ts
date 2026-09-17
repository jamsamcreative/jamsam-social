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
