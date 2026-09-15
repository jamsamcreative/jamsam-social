import { describe, it, expect, vi } from "vitest";
import { fakePlanStore, BRAND } from "./fake-store";
import { importHistoryChunk, mirrorPublishedTarget, topUpHistoryForAllBrands } from "./history-sync";

const page = (ids: string[], next: string | null) => ({ data: ids.map((id) => ({ id, message: id, created_time: "2026-06-01T22:30:00+0000", likes: { summary: { total_count: 1 } }, comments: { summary: { total_count: 0 } } })), paging: next ? { next } : undefined });

describe("importHistoryChunk", () => {
  it("imports one page, stores the cursor, and reports done when there is no next page", async () => {
    const store = fakePlanStore();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page(["1", "2"], "https://graph.facebook.com/v21.0/p/posts?after=x")), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page(["3"], null)), { status: 200 }));
    const conn = { config: { page_id: "p" }, secret: { page_access_token: "T" } };
    const a = await importHistoryChunk(store, { brandId: BRAND.id, platform: "facebook", fetchImpl: fetchImpl as unknown as typeof fetch, connection: conn });
    expect(a).toEqual({ imported: 2, done: false });
    expect(store.cursor.facebook).toContain("after=x");
    const b = await importHistoryChunk(store, { brandId: BRAND.id, platform: "facebook", fetchImpl: fetchImpl as unknown as typeof fetch, connection: conn });
    expect(b).toEqual({ imported: 1, done: true });
    expect(store.cursor.facebook).toBeNull();
    expect(store.history).toHaveLength(3);
  });
  it("fails clearly without a Meta connection", async () => {
    const store = fakePlanStore();
    await expect(importHistoryChunk(store, { brandId: BRAND.id, platform: "facebook", connection: null })).rejects.toThrow(/Meta/);
  });
  it("topUp mode never reads or writes the backfill cursor", async () => {
    const store = fakePlanStore();
    store.cursor = { facebook: "https://graph.facebook.com/v21.0/p/posts?after=keep" };
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(page(["9"], "https://graph.facebook.com/v21.0/p/posts?after=z")), { status: 200 }));
    const conn = { config: { page_id: "p" }, secret: { page_access_token: "T" } };
    const r = await importHistoryChunk(store, { brandId: BRAND.id, platform: "facebook", since: "2026-08-01", fetchImpl: fetchImpl as unknown as typeof fetch, connection: conn, topUp: true });
    expect(r).toEqual({ imported: 1, done: false });
    // No cursorUrl was passed, so fetchImpl must have been called against the base edge, not the stored cursor.
    expect(fetchImpl.mock.calls[0][0].toString()).not.toContain("after=keep");
    expect(store.cursor).toEqual({ facebook: "https://graph.facebook.com/v21.0/p/posts?after=keep" });
  });
});

describe("topUpHistoryForAllBrands", () => {
  it("isolates a brand with no Meta connection: no throw, no cursor touched, not counted", async () => {
    const store = fakePlanStore();
    store.cursor = { facebook: "https://graph.facebook.com/v21.0/p/posts?after=keep" };
    const getConnection = async () => null;
    const result = await topUpHistoryForAllBrands(store, getConnection);
    expect(result).toEqual({ brands: 0, imported: 0 });
    expect(store.cursor).toEqual({ facebook: "https://graph.facebook.com/v21.0/p/posts?after=keep" });
  });
});

describe("mirrorPublishedTarget", () => {
  it("writes a history row linked to the post", async () => {
    const store = fakePlanStore();
    await mirrorPublishedTarget(store, { brandId: BRAND.id, postId: "post1", platform: "instagram", externalId: "ig9", externalUrl: "https://ig/9", caption: "Hi", media: [{ url: "https://x/1.jpg" }], publishedAt: "2026-09-14T22:30:00.000Z" });
    expect(store.history[0]).toMatchObject({ platform: "instagram", external_id: "ig9", post_id: "post1", caption: "Hi", media: [{ url: "https://x/1.jpg", kind: "image" }], permalink: "https://ig/9" });
  });
});
