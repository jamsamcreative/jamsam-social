import { describe, it, expect } from "vitest";
import { currentWindow, previousWindow, lastYearWindow, bucketOf, bucketMode, syncWindow, chunkWindow } from "@/lib/metrics/ranges";

describe("ranges", () => {
  const today = "2026-09-14";
  it("current windows end yesterday", () => {
    expect(currentWindow("30d", today)).toEqual({ start: "2026-08-15", end: "2026-09-13" });
    expect(currentWindow("90d", today)).toEqual({ start: "2026-06-16", end: "2026-09-13" });
    expect(currentWindow("12m", today)).toEqual({ start: "2025-09-14", end: "2026-09-13" });
    expect(currentWindow("all", today, "2026-03-01")).toEqual({ start: "2026-03-01", end: "2026-09-13" });
    expect(currentWindow("all", today)).toEqual({ start: "2025-09-14", end: "2026-09-13" });
  });
  it("previous window is the same length immediately before; last year shifts by a year (leap-safe)", () => {
    expect(previousWindow({ start: "2026-08-15", end: "2026-09-13" })).toEqual({ start: "2026-07-16", end: "2026-08-14" });
    expect(lastYearWindow({ start: "2024-02-29", end: "2024-03-05" })).toEqual({ start: "2023-03-01", end: "2023-03-05" });
  });
  it("buckets to Monday weeks or months", () => {
    expect(bucketOf("2026-09-13", "week")).toBe("2026-09-07"); // Sunday → previous Monday
    expect(bucketOf("2026-09-14", "week")).toBe("2026-09-14"); // Monday
    expect(bucketOf("2026-09-14", "month")).toBe("2026-09");
    expect(bucketMode("30d")).toBe("week");
    expect(bucketMode("12m")).toBe("month");
  });
  it("sync windows honour lag and lookback; backfill covers 395 days; chunks split at 31", () => {
    expect(syncWindow({ backfill: false, today, lagDays: 1, lookbackDays: 3 })).toEqual({ start: "2026-09-11", end: "2026-09-13" });
    expect(syncWindow({ backfill: false, today, lagDays: 3, lookbackDays: 3 })).toEqual({ start: "2026-09-09", end: "2026-09-11" });
    const bf = syncWindow({ backfill: true, today, lagDays: 1, lookbackDays: 3 });
    expect(bf.end).toBe("2026-09-13");
    expect(bf.start).toBe("2025-08-15");
    const chunks = chunkWindow({ start: "2026-01-01", end: "2026-03-05" });
    expect(chunks).toEqual([{ start: "2026-01-01", end: "2026-01-31" }, { start: "2026-02-01", end: "2026-03-03" }, { start: "2026-03-04", end: "2026-03-05" }]);
  });
});
