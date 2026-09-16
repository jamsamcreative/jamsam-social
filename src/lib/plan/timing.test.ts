import { describe, it, expect } from "vitest";
import { resolveSlots, median, zonedParts, normaliseWeekStart } from "./timing";
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

describe("normaliseWeekStart", () => {
  it("snaps any date to the Monday of its week with calendar arithmetic only", () => {
    expect(normaliseWeekStart("2026-09-14")).toBe("2026-09-14"); // Monday stays
    expect(normaliseWeekStart("2026-09-20")).toBe("2026-09-14"); // Sunday belongs to the week that started the previous Monday
    expect(normaliseWeekStart("2026-09-16")).toBe("2026-09-14"); // Wednesday
    expect(normaliseWeekStart("2026-09-19")).toBe("2026-09-14"); // Saturday
    expect(normaliseWeekStart("2026-01-01")).toBe("2025-12-29"); // crosses a year boundary
  });
  it("rejects anything that is not a YYYY-MM-DD date", () => {
    expect(() => normaliseWeekStart("2026-9-14")).toThrow(/YYYY-MM-DD/);
    expect(() => normaliseWeekStart("2026-02-30")).toThrow(/YYYY-MM-DD/);
    expect(() => normaliseWeekStart("")).toThrow(/YYYY-MM-DD/);
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
