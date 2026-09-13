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
