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
    expect(weekStartFor(new Date("2026-09-14T03:00:00Z"), "America/Los_Angeles")).toBe("2026-09-07"); // still Sunday evening in LA (Sep 13, a Sunday) -> Monday of that week is Sep 7
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
