import { describe, it, expect, vi } from "vitest";
import { processPin } from "@/lib/publishers/pins";

const pin = { id: "p1", brand_id: "b1", board_id: "bd", title: "T", description: "D", link: "https://x.com/", alt_text: null, image_url: "https://cdn/1.jpg", attempts: 1 } as never;
const deps = (over = {}) => ({ token: vi.fn(async () => "tok"), publish: vi.fn(async () => ({ id: "99", url: "https://www.pinterest.com/pin/99/" })), save: vi.fn(async () => {}), ...over });

describe("processPin", () => {
  it("publishes with the built payload and saves external ids", async () => {
    const d = deps();
    expect(await processPin(pin, d)).toBe("published");
    expect(d.publish).toHaveBeenCalledWith("tok", expect.objectContaining({ board_id: "bd", media_source: { source_type: "image_url", url: "https://cdn/1.jpg" } }));
    expect(d.save).toHaveBeenCalledWith("p1", expect.objectContaining({ status: "published", external_id: "99", external_url: "https://www.pinterest.com/pin/99/" }));
  });
  it("retries on error while attempts remain, fails permanently at the cap", async () => {
    const boom = vi.fn(async () => { throw new Error("rate limited"); });
    const d = deps({ publish: boom });
    expect(await processPin(pin, d)).toBe("retry");
    expect(d.save).toHaveBeenCalledWith("p1", expect.objectContaining({ status: "approved", error: "rate limited" }));
    expect(await processPin({ ...(pin as object), attempts: 3 } as never, d)).toBe("failed");
  });
  it("fails when Pinterest is not connected", async () => {
    const d = deps({ token: vi.fn(async () => null) });
    expect(await processPin({ ...(pin as object), attempts: 3 } as never, d)).toBe("failed");
    expect(d.save).toHaveBeenCalledWith("p1", expect.objectContaining({ error: expect.stringMatching(/not connected/) }));
  });
});
