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
