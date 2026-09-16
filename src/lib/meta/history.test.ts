import { describe, it, expect, vi } from "vitest";
import { parseFacebookPosts, parseInstagramMedia, fetchHistoryPage } from "./history";

const fb = {
  data: [
    { id: "1_1", message: "Hello", created_time: "2026-06-01T22:30:00+0000", permalink_url: "https://fb/1", attachments: { data: [{ media_type: "photo", media: { image: { src: "https://cdn/1.jpg" } } }] }, likes: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, shares: { count: 1 }, insights: { data: [{ name: "post_impressions_unique", values: [{ value: 900 }] }] } },
    { id: "1_2", created_time: "2026-05-30T22:30:00+0000", attachments: { data: [{ media_type: "album", subattachments: { data: [{ media: { image: { src: "https://cdn/a.jpg" } } }, { media: { image: { src: "https://cdn/b.jpg" } } }] } }] }, likes: { summary: { total_count: 0 } }, comments: { summary: { total_count: 0 } } },
    { id: "1_3", message: "Video", created_time: "2026-05-29T22:30:00+0000", attachments: { data: [{ media_type: "video", media: { image: { src: "https://cdn/thumb.jpg" } } }] } },
  ],
  paging: { next: "https://graph.facebook.com/v21.0/123/posts?after=abc" },
};
const ig = {
  data: [
    { id: "9", caption: "Shop", timestamp: "2026-06-01T22:30:00+0000", permalink: "https://ig/9", media_type: "IMAGE", media_url: "https://cdn/9.jpg", like_count: 7, comments_count: 2, insights: { data: [{ name: "reach", values: [{ value: 300 }] }] } },
    { id: "10", timestamp: "2026-05-30T22:30:00+0000", media_type: "CAROUSEL_ALBUM", media_url: "https://cdn/10.jpg", like_count: 1, comments_count: 0 },
    { id: "11", timestamp: "2026-05-29T22:30:00+0000", media_type: "VIDEO", thumbnail_url: "https://cdn/11.jpg", like_count: 4, comments_count: 1 },
  ],
};

describe("parseFacebookPosts", () => {
  it("maps photos, albums and videos with engagement and reach", () => {
    const { rows, next } = parseFacebookPosts(fb);
    expect(next).toBe("https://graph.facebook.com/v21.0/123/posts?after=abc");
    expect(rows[0]).toEqual({ platform: "facebook", external_id: "1_1", published_at: "2026-06-01T22:30:00.000Z", caption: "Hello", media: [{ url: "https://cdn/1.jpg", kind: "image" }], permalink: "https://fb/1", likes: 12, comments: 3, shares: 1, reach: 900 });
    expect(rows[1]).toMatchObject({ caption: "", media: [{ url: "https://cdn/a.jpg", kind: "carousel" }, { url: "https://cdn/b.jpg", kind: "carousel" }], likes: 0, shares: 0, reach: null });
    expect(rows[2]).toMatchObject({ media: [{ url: "https://cdn/thumb.jpg", kind: "video" }], likes: 0, comments: 0, reach: null });
  });
});

describe("parseInstagramMedia", () => {
  it("maps image, carousel and video with reach when present", () => {
    const { rows, next } = parseInstagramMedia(ig);
    expect(next).toBeNull();
    expect(rows[0]).toEqual({ platform: "instagram", external_id: "9", published_at: "2026-06-01T22:30:00.000Z", caption: "Shop", media: [{ url: "https://cdn/9.jpg", kind: "image" }], permalink: "https://ig/9", likes: 7, comments: 2, shares: 0, reach: 300 });
    expect(rows[1]).toMatchObject({ media: [{ url: "https://cdn/10.jpg", kind: "carousel" }], reach: null });
    expect(rows[2]).toMatchObject({ media: [{ url: "https://cdn/11.jpg", kind: "video" }] });
  });
});

describe("fetchHistoryPage", () => {
  it("calls the posts edge with fields on the first page and follows the cursor url verbatim after", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(fb), { status: 200, headers: { "content-type": "application/json" } }));
    const first = await fetchHistoryPage({ platform: "facebook", token: "T", pageId: "123", cursorUrl: null, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(first.rows).toHaveLength(3);
    const u1 = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(u1.pathname).toBe("/v21.0/123/posts");
    expect(u1.searchParams.get("fields")).toContain("attachments");
    expect(u1.searchParams.get("limit")).toBe("25");
    await fetchHistoryPage({ platform: "facebook", token: "T", pageId: "123", cursorUrl: first.next, fetchImpl: fetchImpl as unknown as typeof fetch });
    const u2 = new URL(String((fetchImpl.mock.calls[1] as unknown[])[0]));
    expect(u2.searchParams.get("after")).toBe("abc");
    expect(u2.searchParams.get("access_token")).toBe("T");
  });
  it("adds since for top-ups and uses the IG media edge", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(ig), { status: 200, headers: { "content-type": "application/json" } }));
    await fetchHistoryPage({ platform: "instagram", token: "T", pageId: "123", igUserId: "77", cursorUrl: null, since: "2026-08-15", fetchImpl: fetchImpl as unknown as typeof fetch });
    const u = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(u.pathname).toBe("/v21.0/77/media");
    expect(u.searchParams.get("since")).toBe("2026-08-15");
  });
  describe("instagram reach fallback", () => {
    const preConversion = { error: { message: "(#100) Media posted before business account conversion", code: 100, error_subcode: 2108006 } };
    const err = () => new Response(JSON.stringify(preConversion), { status: 400, headers: { "content-type": "application/json" } });
    const ok = () => new Response(JSON.stringify(ig), { status: 200, headers: { "content-type": "application/json" } });
    it("retries the first page once without insights when Graph rejects it with code 100", async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(err()).mockResolvedValueOnce(ok());
      const out = await fetchHistoryPage({ platform: "instagram", token: "T", pageId: "123", igUserId: "77", cursorUrl: null, fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(out.rows).toHaveLength(3);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const u1 = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
      const u2 = new URL(String((fetchImpl.mock.calls[1] as unknown[])[0]));
      expect(u1.searchParams.get("fields")).toContain("insights");
      expect(u2.searchParams.get("fields")).not.toContain("insights");
      expect(u2.searchParams.get("limit")).toBe("25");
    });
    it("retries a cursor page once without insights when Graph rejects it with code 100", async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(err()).mockResolvedValueOnce(ok());
      const cursorUrl = `https://graph.facebook.com/v21.0/77/media?fields=${encodeURIComponent("caption,timestamp,insights.metric(reach)")}&limit=25&after=abc`;
      const out = await fetchHistoryPage({ platform: "instagram", token: "T", pageId: "123", igUserId: "77", cursorUrl, fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(out.rows).toHaveLength(3);
      const u2 = new URL(String((fetchImpl.mock.calls[1] as unknown[])[0]));
      expect(u2.searchParams.get("fields")).not.toContain("insights");
      expect(u2.searchParams.get("after")).toBe("abc");
      expect(u2.searchParams.get("access_token")).toBe("T");
    });
    it("gives up after one retry and still throws a non-100 error", async () => {
      const twice = vi.fn().mockResolvedValueOnce(err()).mockResolvedValueOnce(err());
      await expect(fetchHistoryPage({ platform: "instagram", token: "T", pageId: "123", igUserId: "77", cursorUrl: null, fetchImpl: twice as unknown as typeof fetch })).rejects.toThrow(/business account conversion/);
      expect(twice).toHaveBeenCalledTimes(2);
      const other = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 400, headers: { "content-type": "application/json" } }));
      await expect(fetchHistoryPage({ platform: "instagram", token: "T", pageId: "123", igUserId: "77", cursorUrl: null, fetchImpl: other as unknown as typeof fetch })).rejects.toThrow(/Invalid OAuth/);
      expect(other).toHaveBeenCalledTimes(1);
    });
    it("does not retry facebook pages on code 100", async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(err());
      await expect(fetchHistoryPage({ platform: "facebook", token: "T", pageId: "123", cursorUrl: null, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/business account conversion/);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });
  it("throws when instagram is requested without an IG user id", async () => {
    await expect(fetchHistoryPage({ platform: "instagram", token: "T", pageId: "123", cursorUrl: null })).rejects.toThrow(/Instagram/);
  });
  it("rejects with a status-bearing error when a cursor page returns non-JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>rate limited</html>", { status: 429 }));
    await expect(
      fetchHistoryPage({ platform: "facebook", token: "T", pageId: "123", cursorUrl: "https://graph.facebook.com/v21.0/123/posts?after=abc", fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/429/);
  });
  it("surfaces the Graph error message when a cursor page returns a JSON error body", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 400, headers: { "content-type": "application/json" } }),
    );
    await expect(
      fetchHistoryPage({ platform: "facebook", token: "T", pageId: "123", cursorUrl: "https://graph.facebook.com/v21.0/123/posts?after=abc", fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/Invalid OAuth access token/);
  });
});
