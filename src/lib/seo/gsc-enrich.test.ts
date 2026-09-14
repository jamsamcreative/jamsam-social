import { describe, it, expect } from "vitest";
import { enrichFromGsc } from "@/lib/seo/gsc-enrich";

const q = (date: string, dim: string, clicks: number, impressions: number, position: number) => ({ source: "gsc_query" as const, date, dim, metrics: { clicks, impressions, ctr: 0, position } });
const qp = (date: string, dim: string, clicks: number, impressions: number) => ({ source: "gsc_query_page" as const, date, dim, metrics: { clicks, impressions, ctr: 0, position: 0 } });

describe("enrichFromGsc", () => {
  it("weights position by impressions, sums clicks, picks the top page, and applies the impressions gate", () => {
    const rows = [q("2026-09-01", "Metal Roofing", 5, 100, 10), q("2026-09-02", "metal roofing", 15, 300, 20), q("2026-09-02", "tiny query", 0, 3, 40)];
    const pageRows = [qp("2026-09-01", "metal roofing|https://x.com/roofing/", 18, 350), qp("2026-09-02", "metal roofing|https://x.com/", 2, 50)];
    const r = enrichFromGsc(rows, pageRows, { minImpressions: 20 });
    expect(r).toEqual([{ keyword: "metal roofing", our_position: 17.5, our_impressions: 400, our_clicks: 20, our_page: "https://x.com/roofing/" }]);
  });
});
