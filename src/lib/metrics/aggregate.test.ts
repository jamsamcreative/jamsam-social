import { describe, it, expect } from "vitest";
import { costPerLead, pctChange, median, byDim, byBucket, buildOverview, buildSearch } from "@/lib/metrics/aggregate";
import type { MetricRow } from "@/lib/metrics/types";

const w = { start: "2026-09-01", end: "2026-09-14" };
const row = (source: MetricRow["source"], date: string, dim: string, metrics: Record<string, number>, extra?: Record<string, string>): MetricRow => ({ source, date, dim, metrics, extra });

describe("aggregate helpers", () => {
  it("zero-safe ratios and medians", () => {
    expect(costPerLead(100, 0)).toBeNull();
    expect(costPerLead(100, 4)).toBe(25);
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(150, 100)).toBe(50);
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("byDim sums and sorts; byBucket seeds empty buckets", () => {
    const rows = [row("meta_ads_campaign", "2026-09-01", "1", { spend: 5 }, { campaign_name: "A" }), row("meta_ads_campaign", "2026-09-02", "1", { spend: 7 }, { campaign_name: "A" }), row("meta_ads_campaign", "2026-09-02", "2", { spend: 20 }, { campaign_name: "B" })];
    expect(byDim(rows, "spend").map((d) => [d.label, d.metrics.spend])).toEqual([["B", 20], ["A", 12]]);
    const b = byBucket(rows, "week", "spend", w);
    expect(b.map((x) => x.bucket)).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
    expect(b[0].value).toBe(32);
    expect(b[1].value).toBe(0);
  });
});

describe("buildOverview", () => {
  const cur = [
    row("meta_ads_total", "2026-09-01", "_", { spend: 100, clicks: 50, impressions: 1000, link_clicks: 40, leads: 2 }),
    row("meta_ads_campaign", "2026-09-01", "c1", { spend: 100, clicks: 50, impressions: 1000, link_clicks: 40, leads: 2 }, { campaign_name: "Barnwood" }),
    row("ga4_total", "2026-09-01", "_", { sessions: 500, google_ads_cost: 300, google_ads_clicks: 150, leads: 7 }),
    row("ga4_campaign", "2026-09-01", "Roofing", { cost: 300, clicks: 150, impressions: 3000, sessions: 140, leads: 3 }, { campaign_name: "Roofing" }),
    row("ga4_channel", "2026-09-01", "Organic Search", { sessions: 300, engaged_sessions: 200, leads: 4 }),
    row("ga4_channel", "2026-09-01", "Paid Search", { sessions: 140, engaged_sessions: 100, leads: 3 }),
    row("ga4_channel", "2026-09-01", "Paid Social", { sessions: 30, engaged_sessions: 10, leads: 0 }),
  ];
  const prev = [row("meta_ads_total", "2026-08-20", "_", { spend: 50, leads: 0 }), row("ga4_total", "2026-08-20", "_", { sessions: 400, google_ads_cost: 200, google_ads_clicks: 100, leads: 5 }), row("ga4_channel", "2026-08-20", "Organic Search", { sessions: 200 })];
  const vm = buildOverview({ cur, prev, ly: [], window: w, mode: "week" });
  it("tiles: spend sums both platforms; cost/lead per platform; website leads from GA4; never sums platform leads", () => {
    expect(vm.tiles[0]).toMatchObject({ label: "Ad spend", value: 400, prev: 250, change: 60 });
    expect(vm.tiles[1]).toMatchObject({ label: "Meta ads cost / lead", value: 50, prev: null, change: null });
    expect(vm.tiles[2]).toMatchObject({ label: "Google Ads cost / lead", value: 100 });
    expect(vm.tiles[3]).toMatchObject({ label: "Website leads", value: 7, prev: 5, change: 40 });
  });
  it("by platform includes arrived% from the matching GA4 channel", () => {
    const meta = vm.byPlatform.find((p) => p.platform === "Meta ads")!;
    expect(meta).toMatchObject({ spend: 100, clicks: 40, leads: 2, cpl: 50, campaigns: 1 });
    expect(meta.arrived).toBeCloseTo(30 / 40);
    const g = vm.byPlatform.find((p) => p.platform === "Google Ads")!;
    expect(g).toMatchObject({ spend: 300, clicks: 150, leads: 3, cpl: 100 });
    expect(g.arrived).toBeCloseTo(140 / 150);
  });
  it("channels carry share, paid flag and change vs previous", () => {
    const org = vm.channels.find((c) => c.channel === "Organic Search")!;
    expect(org).toMatchObject({ sessions: 300, paid: false, prev: 200, change: 50, lastYear: null });
    expect(org.share).toBeCloseTo(300 / 470);
    expect(vm.channels.find((c) => c.channel === "Paid Search")!.paid).toBe(true);
    expect(vm.paidVsEarned[0]).toEqual({ bucket: "2026-08-31", paid: 170, earned: 300 });
  });
});

describe("buildSearch", () => {
  it("weighted position, ctr, and top queries with change", () => {
    const cur = [
      row("gsc_total", "2026-09-01", "_", { clicks: 10, impressions: 100, ctr: 0.1, position: 10 }),
      row("gsc_total", "2026-09-02", "_", { clicks: 30, impressions: 300, ctr: 0.1, position: 20 }),
      row("gsc_query", "2026-09-01", "metal roofing", { clicks: 8, impressions: 80, ctr: 0.1, position: 5 }),
      row("gsc_query", "2026-09-02", "metal roofing", { clicks: 12, impressions: 120, ctr: 0.1, position: 7 }),
    ];
    const prev = [row("gsc_total", "2026-08-20", "_", { clicks: 20, impressions: 100, ctr: 0.2, position: 15 }), row("gsc_query", "2026-08-20", "metal roofing", { clicks: 10, impressions: 100, ctr: 0.1, position: 9 })];
    const vm = buildSearch({ cur, prev, window: w, mode: "week" });
    expect(vm.tiles[0]).toMatchObject({ label: "Clicks", value: 40, prev: 20, change: 100 });
    expect(vm.tiles[2].value).toBeCloseTo(0.1);
    expect(vm.tiles[3].value).toBeCloseTo(17.5); // (10*100 + 20*300) / 400
    expect(vm.queries[0]).toMatchObject({ dim: "metal roofing", prevClicks: 10, change: 100 });
    expect(vm.queries[0].metrics.position).toBeCloseTo(6.2); // (5*80 + 7*120)/200
    expect(vm.hasData).toBe(true);
  });
});
