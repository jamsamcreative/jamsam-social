import { describe, it, expect } from "vitest";
import { fakePlanStore } from "./fake-store";

describe("fakePlanStore", () => {
  it("upserts history by platform+external_id and computes interactions", async () => {
    const s = fakePlanStore();
    await s.upsertHistory("b1", [{ platform: "facebook", external_id: "1", published_at: "2026-01-01T00:00:00Z", caption: "", media: [], permalink: null, likes: 1, comments: 2, shares: 3, reach: null }]);
    await s.upsertHistory("b1", [{ platform: "facebook", external_id: "1", published_at: "2026-01-01T00:00:00Z", caption: "", media: [], permalink: null, likes: 5, comments: 0, shares: 0, reach: 10 }]);
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toMatchObject({ interactions: 5, reach: 10 });
  });
});
