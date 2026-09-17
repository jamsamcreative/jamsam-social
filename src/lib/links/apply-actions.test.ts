import { describe, it, expect, vi } from "vitest";
import { approveSuggestion, rejectSuggestion, undoSuggestion, type WpAdapter } from "./apply-actions";
import { BRAND, fakeLinksStore, page } from "./fake-store";
import type { LinkSuggestionRow } from "./store";

const HOST_HTML = `<!-- wp:paragraph --><p>Our horse barns are sturdy. Beta is here.</p><!-- /wp:paragraph -->`;
const ORPHAN_URL = "https://acme.com/horse-barns/";

/** A fake store with host `b` (wp_id 7) and orphan `c`, plus one suggestion row of the given status. */
function seed(status: LinkSuggestionRow["status"] = "pending", over: Partial<LinkSuggestionRow> = {}) {
  const store = fakeLinksStore({
    pages: [
      page("b", { wp_id: 7, title: "Beta Post", content_text: "Our horse barns are sturdy. Beta is here." }),
      page("c", { wp_id: 8, title: "Horse Barns", url: ORPHAN_URL, content_text: "All about barns." }),
    ],
  });
  const now = new Date().toISOString();
  store.suggestions.push({
    id: "s1", brand_id: BRAND.id, orphan_page_id: "c", host_page_id: "b", phrase: "horse barns", context: "Our horse barns are sturdy.",
    status, reason: null, phrases_tried: [], href: null, undo_snippet: null, applied_at: null, applied_by: null, created_at: now, updated_at: now, ...over,
  });
  return store;
}

/** In-memory WordPress: a map of wp_id → raw post HTML. */
function fakeWp(init: Record<number, string>): WpAdapter & { posts: Map<number, string>; update: ReturnType<typeof vi.fn> } {
  const posts = new Map<number, string>(Object.entries(init).map(([k, v]) => [Number(k), v]));
  const update = vi.fn(async (wpId: number, content: string) => { posts.set(wpId, content); });
  return {
    posts, update,
    async getRaw(wpId) { const h = posts.get(wpId); if (h === undefined) throw new Error(`no post ${wpId}`); return h; },
  };
}

const SNIPPET = `<a href="${ORPHAN_URL}">horse barns</a>`;

describe("approveSuggestion", () => {
  it("wraps the phrase in the host, writes it to WordPress, records href/undo_snippet/applied_by and adds an edge", async () => {
    const store = seed();
    const wp = fakeWp({ 7: HOST_HTML });

    expect(await approveSuggestion(store, { id: "s1", userId: "u1", wp })).toEqual({ ok: true });

    expect(wp.update).toHaveBeenCalledTimes(1);
    expect(wp.posts.get(7)).toBe(`<!-- wp:paragraph --><p>Our ${SNIPPET} are sturdy. Beta is here.</p><!-- /wp:paragraph -->`);
    const s = (await store.getSuggestion("s1"))!;
    expect(s.status).toBe("approved");
    expect(s.href).toBe(ORPHAN_URL);
    expect(s.undo_snippet).toBe(SNIPPET);
    expect(s.applied_by).toBe("u1");
    expect(s.applied_at).toBeTruthy();
    expect(await store.listEdges(BRAND.id)).toEqual([{ from_page_id: "b", to_page_id: "c", href: ORPHAN_URL, anchor_text: "horse barns" }]);
  });

  it("marks the suggestion stale and writes nothing when the phrase is no longer in the post", async () => {
    const store = seed();
    const wp = fakeWp({ 7: `<p>The post was rewritten.</p>` });

    expect(await approveSuggestion(store, { id: "s1", userId: "u1", wp })).toEqual({ ok: false, stale: true, error: "Post changed since the scan — rescan" });

    expect(wp.update).not.toHaveBeenCalled();
    expect((await store.getSuggestion("s1"))!.status).toBe("stale");
    expect(await store.listEdges(BRAND.id)).toEqual([]);
  });

  it("refuses a suggestion that is not pending, and an unknown id", async () => {
    const store = seed("rejected");
    const wp = fakeWp({ 7: HOST_HTML });
    expect(await approveSuggestion(store, { id: "s1", userId: "u1", wp })).toEqual({ ok: false, error: "Only pending suggestions can be approved" });
    expect(await approveSuggestion(store, { id: "nope", userId: "u1", wp })).toEqual({ ok: false, error: "Suggestion not found" });
    expect(wp.update).not.toHaveBeenCalled();
    expect((await store.getSuggestion("s1"))!.status).toBe("rejected");
  });

  it("leaves the suggestion pending when the WordPress write fails", async () => {
    const store = seed();
    const wp = fakeWp({ 7: HOST_HTML });
    wp.update.mockRejectedValueOnce(new Error("WordPress responded 500"));
    expect(await approveSuggestion(store, { id: "s1", userId: "u1", wp })).toEqual({ ok: false, error: "WordPress responded 500" });
    expect((await store.getSuggestion("s1"))!.status).toBe("pending");
    expect(await store.listEdges(BRAND.id)).toEqual([]);
  });
});

describe("undoSuggestion", () => {
  it("restores the post, sets status undone and removes the edge", async () => {
    const store = seed();
    const wp = fakeWp({ 7: HOST_HTML });
    await approveSuggestion(store, { id: "s1", userId: "u1", wp });

    expect(await undoSuggestion(store, { id: "s1", userId: "u1", wp })).toEqual({ ok: true });

    expect(wp.posts.get(7)).toBe(HOST_HTML);
    expect((await store.getSuggestion("s1"))!.status).toBe("undone");
    expect(await store.listEdges(BRAND.id)).toEqual([]);
  });

  it("refuses a suggestion that was never approved", async () => {
    const store = seed();
    const wp = fakeWp({ 7: HOST_HTML });
    expect(await undoSuggestion(store, { id: "s1", userId: "u1", wp })).toEqual({ ok: false, error: "Only approved links can be undone" });
    expect(wp.update).not.toHaveBeenCalled();
  });

  it("still marks the link undone when someone already removed it from the post by hand", async () => {
    const store = seed("approved", { href: ORPHAN_URL, undo_snippet: SNIPPET, applied_at: new Date().toISOString(), applied_by: "u1" });
    await store.addEdge(BRAND.id, { from_page_id: "b", to_page_id: "c", href: ORPHAN_URL, anchor_text: "horse barns" });
    const wp = fakeWp({ 7: HOST_HTML });

    const r = await undoSuggestion(store, { id: "s1", userId: "u1", wp });
    expect(r.ok).toBe(true);
    expect(wp.update).not.toHaveBeenCalled();
    expect((await store.getSuggestion("s1"))!.status).toBe("undone");
    expect(await store.listEdges(BRAND.id)).toEqual([]);
  });
});

describe("rejectSuggestion", () => {
  it("sets status rejected on a pending suggestion", async () => {
    const store = seed();
    expect(await rejectSuggestion(store, { id: "s1" })).toEqual({ ok: true });
    expect((await store.getSuggestion("s1"))!.status).toBe("rejected");
  });
  it("refuses anything that is not pending", async () => {
    const store = seed("approved");
    expect(await rejectSuggestion(store, { id: "s1" })).toEqual({ ok: false, error: "Only pending suggestions can be rejected" });
    expect((await store.getSuggestion("s1"))!.status).toBe("approved");
  });
});
