import { describe, it, expect, vi } from "vitest";
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
    // One sync_runs row per build; a skipped week does not record a run
    expect(store.runs).toEqual([{ brand_id: BRAND.id, ok: true, error: undefined }]);
  });
  it("records a per-brand failure in sync_runs and the console instead of throwing when the build blows up", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = fakePlanStore({ schedule });
    store.listProjects = async () => { throw new Error("projects table unavailable"); };
    await expect(runPlanCycle(store, new Date("2026-09-14T13:00:00Z"))).resolves.toEqual({ built: [], skipped: [], failed: [{ brand: BRAND.slug, error: "projects table unavailable" }] });
    expect(store.posts).toEqual([]);
    expect(store.weeks).toEqual([]);
    expect(store.runs).toEqual([{ brand_id: BRAND.id, ok: false, error: "projects table unavailable" }]);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/acme.*projects table unavailable/));
    error.mockRestore();
  });
  it("still reports the failure when recording the run itself fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = fakePlanStore({ schedule });
    store.listProjects = async () => { throw new Error("boom"); };
    store.recordPlanRun = async () => { throw new Error("sync_runs unavailable"); };
    await expect(runPlanCycle(store, new Date("2026-09-14T13:00:00Z"))).resolves.toEqual({ built: [], skipped: [], failed: [{ brand: BRAND.slug, error: "boom" }] });
    error.mockRestore();
  });
  it("skips brands without a schedule", async () => {
    const store = fakePlanStore({ schedule: null });
    expect(await runPlanCycle(store, new Date("2026-09-14T13:00:00Z"))).toEqual({ built: [], skipped: [`${BRAND.slug}:no-schedule`], failed: [] });
  });
});
