import { describe, it, expect } from "vitest";
import { fakeLinksStore, BRAND, page } from "./fake-store";

const B = BRAND.id;
const sug = (orphan: string, host: string, phrase: string) => ({ orphan_page_id: orphan, host_page_id: host, phrase, context: `… ${phrase} …` });
const none = (orphan: string) => ({ orphan_page_id: orphan, reason: "no other post mentions the topic" as const, phrases_tried: ["x y"] });

describe("fakeLinksStore.upsertScanResults", () => {
  it("creates pending and none rows for a first scan", async () => {
    const s = fakeLinksStore({ pages: [page("o1"), page("o2"), page("h1")] });
    const r = await s.upsertScanResults(B, [sug("o1", "h1", "pole barn"), none("o2")], ["o1", "o2"]);
    expect(r).toEqual({ created: 2, staled: 0, removed: 0 });
    const rows = await s.listSuggestions(B);
    expect(rows.map((x) => [x.orphan_page_id, x.host_page_id, x.phrase, x.status]).sort()).toEqual([["o1", "h1", "pole barn", "pending"], ["o2", null, null, "none"]]);
    expect(rows.find((x) => x.orphan_page_id === "o2")).toMatchObject({ reason: "no other post mentions the topic", phrases_tried: ["x y"] });
  });

  it("keeps an identical pending row (same id), stales a changed one, and replaces none rows", async () => {
    const s = fakeLinksStore({ pages: [page("o1"), page("o2"), page("o3"), page("h1"), page("h2")] });
    await s.upsertScanResults(B, [sug("o1", "h1", "pole barn"), sug("o2", "h1", "shop plans"), none("o3")], ["o1", "o2", "o3"]);
    const before = await s.listSuggestions(B);
    const keptId = before.find((x) => x.orphan_page_id === "o1")!.id;

    const r = await s.upsertScanResults(B, [sug("o1", "h1", "pole barn"), sug("o2", "h2", "shop plans"), sug("o3", "h1", "garage")], ["o1", "o2", "o3"]);
    expect(r).toEqual({ created: 2, staled: 1, removed: 0 });

    const after = await s.listSuggestions(B);
    expect(after.find((x) => x.orphan_page_id === "o1")).toMatchObject({ id: keptId, status: "pending", host_page_id: "h1", phrase: "pole barn" });
    const o2 = after.filter((x) => x.orphan_page_id === "o2").map((x) => [x.host_page_id, x.status]).sort();
    expect(o2).toEqual([["h1", "stale"], ["h2", "pending"]]);
    // the old none row for o3 is gone; only the new pending remains
    expect(after.filter((x) => x.orphan_page_id === "o3").map((x) => x.status)).toEqual(["pending"]);
    expect(await s.listSuggestions(B, ["pending"])).toHaveLength(3);
  });

  it("removes pending/none rows for pages that are no longer orphans but keeps history rows", async () => {
    const s = fakeLinksStore({ pages: [page("o1"), page("o2"), page("o3"), page("h1")] });
    await s.upsertScanResults(B, [sug("o1", "h1", "pole barn"), none("o2"), sug("o3", "h1", "garage")], ["o1", "o2", "o3"]);
    const o3 = (await s.listSuggestions(B)).find((x) => x.orphan_page_id === "o3")!;
    await s.setStatus(o3.id, { status: "approved", href: "https://acme.com/o3", undo_snippet: '<a href="https://acme.com/o3">garage</a>', applied_at: "2026-01-01T00:00:00Z", applied_by: "u1" });

    const r = await s.upsertScanResults(B, [], []);
    expect(r).toEqual({ created: 0, staled: 0, removed: 2 });
    const left = await s.listSuggestions(B);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ orphan_page_id: "o3", status: "approved", href: "https://acme.com/o3", applied_by: "u1" });
  });

  it("stales a pending row when the orphan now gets a none verdict", async () => {
    const s = fakeLinksStore({ pages: [page("o1"), page("h1")] });
    await s.upsertScanResults(B, [sug("o1", "h1", "pole barn")], ["o1"]);
    const r = await s.upsertScanResults(B, [none("o1")], ["o1"]);
    expect(r).toEqual({ created: 1, staled: 1, removed: 0 });
    expect((await s.listSuggestions(B)).map((x) => x.status).sort()).toEqual(["none", "stale"]);
  });
});

describe("fakeLinksStore.rejectedKeys", () => {
  it("returns host|phrase for rejected rows of that orphan only", async () => {
    const s = fakeLinksStore({ pages: [page("o1"), page("o2"), page("h1"), page("h2")] });
    await s.upsertScanResults(B, [sug("o1", "h1", "pole barn"), sug("o2", "h2", "shop plans")], ["o1", "o2"]);
    const rows = await s.listSuggestions(B);
    for (const r of rows) await s.setStatus(r.id, { status: "rejected" });
    await s.upsertScanResults(B, [sug("o1", "h2", "pole barn")], ["o1", "o2"]);
    expect(await s.rejectedKeys(B, "o1")).toEqual(new Set(["h1|pole barn"]));
    expect(await s.rejectedKeys(B, "o2")).toEqual(new Set(["h2|shop plans"]));
    expect(await s.rejectedKeys(B, "h1")).toEqual(new Set());
  });
});

describe("fakeLinksStore edges, pages, scans and counts", () => {
  it("replaces, adds, removes and lists edges", async () => {
    const s = fakeLinksStore({ pages: [page("a"), page("b"), page("c")] });
    await s.replaceEdges(B, [{ from_page_id: "a", to_page_id: "b", href: "https://acme.com/b", anchor_text: "b" }]);
    await s.addEdge(B, { from_page_id: "a", to_page_id: "c", href: "https://acme.com/c", anchor_text: "c" });
    expect((await s.listEdges(B)).map((e) => e.to_page_id)).toEqual(["b", "c"]);
    await s.removeEdge(B, "a", "b", "https://acme.com/b");
    expect((await s.listEdges(B)).map((e) => e.to_page_id)).toEqual(["c"]);
    await s.replaceEdges(B, []);
    expect(await s.listEdges(B)).toEqual([]);
  });

  it("lists pages with content_text defaulting to '' and gets a page by id", async () => {
    const s = fakeLinksStore({ pages: [page("a", { content_text: "" }), page("b", { content_text: "hello" })] });
    expect((await s.listPages(B)).map((p) => p.content_text)).toEqual(["", "hello"]);
    expect(await s.getPage("b")).toMatchObject({ id: "b", wp_id: expect.any(Number), content_text: "hello" });
    expect(await s.getPage("zzz")).toBeNull();
  });

  it("logs scans, reports the last scan and counts", async () => {
    const s = fakeLinksStore({ pages: [page("o1"), page("h1")] });
    expect(await s.lastScan(B)).toBeNull();
    await s.logScan(B, "2 pages, 0 links, 1 orphans", 2, "u1");
    expect(await s.lastScan(B)).toEqual(expect.any(String));
    expect(s.imports[0]).toMatchObject({ kind: "link_scan", detail: "2 pages, 0 links, 1 orphans", rows: 2, created_by: "u1" });
    await s.upsertScanResults(B, [sug("o1", "h1", "pole barn")], ["o1"]);
    expect(await s.counts(B)).toEqual({ pages: 2, pending: 1, added: 0 });
    await s.setStatus((await s.listSuggestions(B))[0].id, { status: "approved" });
    expect(await s.counts()).toEqual({ pages: 2, pending: 0, added: 1 });
  });
});
