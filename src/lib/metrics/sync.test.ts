import { describe, it, expect, vi } from "vitest";
import { syncBrand, type SyncDeps } from "@/lib/metrics/sync";

function deps(over: Partial<SyncDeps> = {}): SyncDeps & { upserts: unknown[][]; runs: unknown[] } {
  const upserts: unknown[][] = [];
  const runs: unknown[] = [];
  return {
    store: { upsertRows: vi.fn(async (_b, rows) => void upserts.push(rows)), recordRun: vi.fn(async (_b, source, patch) => void runs.push({ source, ...patch })) },
    ga4: { runReport: vi.fn(async (_p, body) => ({ rows: body.dimensions?.length === 2 ? [{ dims: ["20260911", body.dimensions[1].name === "sessionDefaultChannelGroup" ? "Organic Search" : "Roofing"], metrics: [10, 5, 1, 1, 0] }] : [{ dims: ["20260911"], metrics: [10, 20, 30, 1] }] })) },
    gsc: { query: vi.fn(async (_s, body) => ({ rows: body.dimensions.length === 1 ? [{ keys: ["2026-09-09"], clicks: 1, impressions: 10, ctr: 0.1, position: 5 }] : [{ keys: ["2026-09-09", "q1"], clicks: 3, impressions: 10, ctr: 0.3, position: 5 }, { keys: ["2026-09-09", "q2"], clicks: 1, impressions: 10, ctr: 0.1, position: 8 }] })) },
    metaAds: { insights: vi.fn(async (_a, _t, o) => [{ date_start: "2026-09-11", date_stop: "2026-09-11", campaign_id: o.level === "campaign" ? "c1" : undefined, campaign_name: "A", spend: "5", clicks: "2", impressions: "100" }]) },
    today: "2026-09-14",
    upserts,
    runs,
    ...over,
  };
}
const conns = { ga4: { property_id: "1", lead_events: ["form_submit"], ads_linked: true }, gsc: { site_url: "sc-domain:x.com" }, meta_ads: { ad_account_id: "act_1", access_token: "t" } };

describe("syncBrand", () => {
  it("syncs every connected source with the right windows and records runs", async () => {
    const d = deps();
    const r = await syncBrand("b1", conns, d);
    expect(r.ga4).toMatchObject({ ok: true, rows: 3 }); // channel + total + campaign
    expect(r.gsc).toMatchObject({ ok: true, rows: 5 }); // total + 2 queries + 2 pages
    expect(r.meta_ads).toMatchObject({ ok: true, rows: 2 });
    const ga4Body = (d.ga4!.runReport as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(ga4Body.dateRanges).toEqual([{ startDate: "2026-09-11", endDate: "2026-09-13" }]);
    expect(ga4Body.metrics.map((m: { name: string }) => m.name)).toContain("keyEvents:form_submit");
    const gscBody = (d.gsc!.query as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(gscBody).toMatchObject({ startDate: "2026-09-09", endDate: "2026-09-11" });
    expect(d.runs).toEqual(expect.arrayContaining([{ source: "ga4", ok: true, backfilled: undefined }, { source: "gsc", ok: true, backfilled: undefined }]));
  });
  it("skips unconnected sources and skips the Ads campaign report when not linked", async () => {
    const d = deps();
    const r = await syncBrand("b1", { ga4: { property_id: "1", lead_events: [], ads_linked: false } }, d);
    expect(r.gsc.skipped).toBe(true);
    expect(r.meta_ads.skipped).toBe(true);
    expect(d.ga4!.runReport).toHaveBeenCalledTimes(2);
  });
  it("a failing source records the error and the others still complete", async () => {
    const d = deps({ gsc: { query: vi.fn(async () => { throw new Error("403 add the service account"); }) } });
    const r = await syncBrand("b1", conns, d);
    expect(r.gsc).toMatchObject({ ok: false, error: /403/ });
    expect(r.ga4.ok).toBe(true);
    expect(r.meta_ads.ok).toBe(true);
    expect(d.runs).toEqual(expect.arrayContaining([{ source: "gsc", ok: false, error: "403 add the service account" }]));
  });
  it("backfill pages a 13-month window in 31-day chunks and flags the run", async () => {
    const d = deps();
    await syncBrand("b1", { meta_ads: conns.meta_ads }, d, { backfill: { meta_ads: true } });
    const calls = (d.metaAds!.insights as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2 * 13); // campaign + account per chunk, 395 days → 13 chunks
    expect(calls[0][2]).toMatchObject({ since: "2025-08-15", until: "2025-09-14" });
    expect(d.runs).toEqual(expect.arrayContaining([{ source: "meta_ads", ok: true, backfilled: true }]));
  });
});
