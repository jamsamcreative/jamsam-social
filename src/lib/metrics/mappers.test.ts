import { describe, it, expect } from "vitest";
import { mapGa4Channels, mapGa4Totals, mapGa4Campaigns, mapGsc, mapMetaCampaigns, mapMetaTotals } from "@/lib/metrics/mappers";

describe("mappers", () => {
  it("GA4 channels: sums key events into leads and formats the date", () => {
    expect(mapGa4Channels([{ dims: ["20260901", "Organic Search"], metrics: [100, 60, 2, 1] }])).toEqual([{ source: "ga4_channel", date: "2026-09-01", dim: "Organic Search", metrics: { sessions: 100, engaged_sessions: 60, leads: 3 } }]);
  });
  it("GA4 totals carry Google Ads cost/clicks and leads", () => {
    expect(mapGa4Totals([{ dims: ["20260901"], metrics: [500, 120.5, 300, 4] }])[0].metrics).toEqual({ sessions: 500, google_ads_cost: 120.5, google_ads_clicks: 300, leads: 4 });
  });
  it("GA4 campaigns drop (not set) and zero-cost rows", () => {
    const rows = mapGa4Campaigns([{ dims: ["20260901", "Metal Roofing"], metrics: [50, 20, 900, 18, 1] }, { dims: ["20260901", "(not set)"], metrics: [10, 1, 1, 1, 0] }, { dims: ["20260901", "Organic thing"], metrics: [0, 5, 0, 5, 0] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dim: "Metal Roofing", metrics: { cost: 50, clicks: 20, impressions: 900, sessions: 18, leads: 1 }, extra: { campaign_name: "Metal Roofing" } });
  });
  it("GSC totals and dimensions", () => {
    expect(mapGsc([{ keys: ["2026-09-01"], clicks: 5, impressions: 100, ctr: 0.05, position: 12 }], "gsc_total")[0]).toMatchObject({ dim: "_", metrics: { clicks: 5, position: 12 } });
    expect(mapGsc([{ keys: ["2026-09-01", "metal roofing spokane"], clicks: 5, impressions: 100, ctr: 0.05, position: 12 }], "gsc_query")[0].dim).toBe("metal roofing spokane");
  });
  it("Meta: leads from the lead action types only; campaign rows keep names", () => {
    const row = { date_start: "2026-09-01", date_stop: "2026-09-01", campaign_id: "1", campaign_name: "Post: Barnwood", spend: "19.50", clicks: "48", impressions: "4000", inline_link_clicks: "30", actions: [{ action_type: "lead", value: "2" }, { action_type: "link_click", value: "30" }, { action_type: "offsite_conversion.fb_pixel_lead", value: "1" }] };
    expect(mapMetaCampaigns([row])[0]).toEqual({ source: "meta_ads_campaign", date: "2026-09-01", dim: "1", metrics: { spend: 19.5, clicks: 48, impressions: 4000, link_clicks: 30, leads: 3 }, extra: { campaign_name: "Post: Barnwood" } });
    expect(mapMetaTotals([{ ...row, campaign_id: undefined }])[0]).toMatchObject({ source: "meta_ads_total", dim: "_", metrics: { spend: 19.5, leads: 3 } });
  });
});
