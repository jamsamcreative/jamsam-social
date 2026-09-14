import { describe, it, expect, vi } from "vitest";
import { processTarget } from "@/lib/publishers/run";

const target = { id: "t1", post_id: "p1", platform: "facebook", caption: "c", attempts: 1 } as unknown as Parameters<typeof processTarget>[0];
const post = { id: "p1", brand_id: "b1", link_url: null, media: [{ url: "u" }] } as never;

function deps(over: Partial<Parameters<typeof processTarget>[1]> = {}) {
  return {
    loadPost: vi.fn(async () => post),
    loadMeta: vi.fn(async () => ({ config: { page_id: "pg", ig_user_id: "ig" }, secret: { page_access_token: "tok" } })),
    publishFb: vi.fn(async () => ({ external_id: "x", external_url: "https://fb/x" })),
    publishIg: vi.fn(async () => ({ external_id: "y", external_url: null })),
    save: vi.fn(async () => {}),
    ...over,
  };
}

describe("processTarget", () => {
  it("publishes to facebook and saves published", async () => {
    const d = deps();
    expect(await processTarget(target, d)).toBe("published");
    expect(d.publishFb).toHaveBeenCalledWith("pg", "tok", { caption: "c", link_url: null, media: [{ url: "u" }] });
    expect(d.save).toHaveBeenCalledWith("t1", expect.objectContaining({ status: "published", external_id: "x" }));
  });
  it("retries on error when attempts remain", async () => {
    const d = deps({
      publishFb: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    expect(await processTarget(target, d)).toBe("retry");
    expect(d.save).toHaveBeenCalledWith("t1", expect.objectContaining({ status: "pending", error: "boom" }));
  });
  it("fails permanently on the third attempt", async () => {
    const d = deps({
      publishFb: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    expect(await processTarget({ ...target, attempts: 3 } as never, d)).toBe("failed");
    expect(d.save).toHaveBeenCalledWith("t1", expect.objectContaining({ status: "failed" }));
  });
  it("fails when the brand has no meta connection", async () => {
    const d = deps({ loadMeta: vi.fn(async () => null) });
    expect(await processTarget({ ...target, attempts: 3 } as never, d)).toBe("failed");
    expect(d.save).toHaveBeenCalledWith("t1", expect.objectContaining({ error: expect.stringMatching(/not connected/i) }));
  });
  it("fails instagram when no ig account is linked", async () => {
    const d = deps({ loadMeta: vi.fn(async () => ({ config: { page_id: "pg" }, secret: { page_access_token: "tok" } })) });
    expect(await processTarget({ ...target, platform: "instagram", attempts: 3 } as never, d)).toBe("failed");
    expect(d.save).toHaveBeenCalledWith("t1", expect.objectContaining({ error: expect.stringMatching(/instagram/i) }));
  });
});

describe("processTarget gbp", () => {
  const gbpTarget = { ...(target as object), id: "t9", platform: "gbp", location_ref: "locations/123" } as never;
  it("publishes to a Google location with the brand's refresh token", async () => {
    const d = deps({ loadGbp: vi.fn(async () => ({ secret: { refresh_token: "rt" } })), publishGbp: vi.fn(async () => ({ external_id: "locations/123/localPosts/9", external_url: "https://g.co/x" })) });
    expect(await processTarget(gbpTarget, d)).toBe("published");
    expect(d.publishGbp).toHaveBeenCalledWith("locations/123", "rt", { caption: "c", link_url: null, media: [{ url: "u" }] });
    expect(d.save).toHaveBeenCalledWith("t9", expect.objectContaining({ status: "published", external_id: "locations/123/localPosts/9" }));
  });
  it("fails when GBP is not connected", async () => {
    const d = deps({ loadGbp: vi.fn(async () => null) });
    expect(await processTarget({ ...(gbpTarget as object), attempts: 3 } as never, d)).toBe("failed");
    expect(d.save).toHaveBeenCalledWith("t9", expect.objectContaining({ error: expect.stringMatching(/not connected/) }));
  });
});
