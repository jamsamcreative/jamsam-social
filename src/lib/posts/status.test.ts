import { describe, it, expect } from "vitest";
import { derivePostStatus, validateForSubmit } from "@/lib/posts/status";

describe("derivePostStatus", () => {
  it("is publishing while any target is publishing", () => {
    expect(derivePostStatus("approved", [{ status: "publishing" }, { status: "pending" }])).toBe("publishing");
  });
  it("is published when all targets are published", () => {
    expect(derivePostStatus("publishing", [{ status: "published" }, { status: "published" }])).toBe("published");
  });
  it("is failed when a target failed and nothing is still pending", () => {
    expect(derivePostStatus("publishing", [{ status: "published" }, { status: "failed" }])).toBe("failed");
  });
  it("stays approved while a failed target has been retried (pending)", () => {
    expect(derivePostStatus("failed", [{ status: "published" }, { status: "pending" }])).toBe("approved");
  });
  it("leaves draft alone", () => {
    expect(derivePostStatus("draft", [{ status: "pending" }])).toBe("draft");
  });
});

describe("validateForSubmit", () => {
  const ok = { platform: "facebook" as const, enabled: true, caption: "hi", scheduled_at: "2026-09-14T22:00:00Z" };
  it("accepts a valid facebook-only post with no media", () => {
    expect(validateForSubmit({ media: [], targets: [ok] })).toBeNull();
  });
  it("requires at least one enabled target", () => {
    expect(validateForSubmit({ media: [], targets: [{ ...ok, enabled: false }] })).toMatch(/at least one platform/i);
  });
  it("requires caption and schedule on enabled targets", () => {
    expect(validateForSubmit({ media: [], targets: [{ ...ok, caption: " " }] })).toMatch(/caption/i);
    expect(validateForSubmit({ media: [], targets: [{ ...ok, scheduled_at: null }] })).toMatch(/schedule/i);
  });
  it("requires an image for instagram", () => {
    expect(validateForSubmit({ media: [], targets: [{ ...ok, platform: "instagram" }] })).toMatch(/instagram.*image/i);
  });
  it("caps media at 10", () => {
    expect(validateForSubmit({ media: new Array(11).fill({}), targets: [ok] })).toMatch(/10/);
  });
});
