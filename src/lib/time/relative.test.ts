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
