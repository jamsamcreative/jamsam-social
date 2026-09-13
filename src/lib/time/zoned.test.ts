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
    const iso = zonedLocalToUtc("2026-03-08T12:30", "America/Denver"); // DST switch day, real time
    expect(utcToZonedLocal(iso, "America/Denver")).toBe("2026-03-08T12:30");
  });
  it("formats for humans", () => {
    expect(formatInZone("2026-07-30T22:40:00Z", "America/Los_Angeles")).toBe("Jul 30, 3:40 PM");
  });
});
