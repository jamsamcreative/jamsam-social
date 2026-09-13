import { describe, it, expect, vi } from "vitest";
import { fetchFacebookInsights, fetchInstagramInsights } from "@/lib/insights/fetch";

describe("insights", () => {
  it("facebook maps likes/comments/shares/reach", async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      expect(u.searchParams.get("fields")).toContain("likes.summary(true)");
      return new Response(
        JSON.stringify({
          likes: { summary: { total_count: 5 } },
          comments: { summary: { total_count: 2 } },
          shares: { count: 1 },
          insights: { data: [{ name: "post_impressions_unique", values: [{ value: 40 }] }] },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    expect(await fetchFacebookInsights("p", "t", f)).toMatchObject({ likes: 5, comments: 2, shares: 1, reach: 40 });
  });
  it("instagram maps like/comments and reach/saved", async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/insights"))
        return new Response(JSON.stringify({ data: [{ name: "reach", values: [{ value: 30 }] }, { name: "saved", values: [{ value: 3 }] }] }), { status: 200 });
      return new Response(JSON.stringify({ like_count: 7, comments_count: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchInstagramInsights("m", "t", f)).toMatchObject({ likes: 7, comments: 1, reach: 30, saved: 3 });
  });
});
