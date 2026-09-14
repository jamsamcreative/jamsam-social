import { syncWindow, chunkWindow, type Window } from "./ranges";
import { mapGa4Channels, mapGa4Totals, mapGa4Campaigns, withAdsTotals, mapGsc, mapMetaCampaigns, mapMetaTotals } from "./mappers";
import type { MetricRow } from "./types";
import type { Ga4Row, Ga4ReportBody } from "@/lib/google/ga4";
import type { GscRow, GscQueryBody } from "@/lib/google/gsc";
import type { MetaInsightRow } from "@/lib/meta/ads";

export type MetricsStore = {
  upsertRows(brandId: string, rows: MetricRow[]): Promise<void>;
  recordRun(brandId: string, source: SyncSource, patch: { ok: boolean; error?: string; backfilled?: boolean }): Promise<void>;
};
export type SyncSource = "ga4" | "gsc" | "meta_ads";
export type Ga4Client = { runReport(propertyId: string, body: Ga4ReportBody): Promise<{ rows: Ga4Row[] }> };
export type GscClient = { query(siteUrl: string, body: GscQueryBody): Promise<{ rows: GscRow[] }> };
export type MetaAdsClient = { insights(adAccountId: string, token: string, opts: { since: string; until: string; level: "campaign" | "account" }): Promise<MetaInsightRow[]> };
export type BrandMetricConnections = {
  ga4?: { property_id: string; lead_events: string[]; ads_linked?: boolean };
  gsc?: { site_url: string };
  meta_ads?: { ad_account_id: string; access_token: string };
};
export type SyncDeps = { store: MetricsStore; ga4?: Ga4Client; gsc?: GscClient; metaAds?: MetaAdsClient; today: string };
export type SyncResult = Record<SyncSource, { ok: boolean; rows: number; error?: string; skipped?: boolean }>;

export const LOOKBACK_DAYS = 3;
export const GSC_LAG_DAYS = 3;
export const BACKFILL_DAYS = 395;

const keyEventMetrics = (events: string[]) => events.map((e) => ({ name: `keyEvents:${e}` }));

async function syncGa4(brandId: string, c: NonNullable<BrandMetricConnections["ga4"]>, client: Ga4Client, w: Window): Promise<MetricRow[]> {
  const out: MetricRow[] = [];
  for (const chunk of chunkWindow(w)) {
    const dateRanges = [{ startDate: chunk.start, endDate: chunk.end }];
    const ke = keyEventMetrics(c.lead_events);
    const [channels, totals] = await Promise.all([
      client.runReport(c.property_id, { dateRanges, dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }, { name: "engagedSessions" }, ...ke] }),
      client.runReport(c.property_id, { dateRanges, dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, ...ke] }),
    ]);
    let campaigns: MetricRow[] = [];
    if (c.ads_linked) {
      const camp = await client.runReport(c.property_id, {
        dateRanges,
        dimensions: [{ name: "date" }, { name: "sessionGoogleAdsCampaignName" }],
        metrics: [{ name: "advertiserAdCost" }, { name: "advertiserAdClicks" }, { name: "advertiserAdImpressions" }, { name: "sessions" }, ...ke],
      });
      campaigns = mapGa4Campaigns(camp.rows);
    }
    out.push(...mapGa4Channels(channels.rows), ...withAdsTotals(mapGa4Totals(totals.rows), campaigns), ...campaigns);
  }
  return out;
}

async function syncGsc(brandId: string, c: NonNullable<BrandMetricConnections["gsc"]>, client: GscClient, w: Window): Promise<MetricRow[]> {
  const out: MetricRow[] = [];
  for (const chunk of chunkWindow(w)) {
    const base = { startDate: chunk.start, endDate: chunk.end };
    const totals = await client.query(c.site_url, { ...base, dimensions: ["date"] });
    out.push(...mapGsc(totals.rows, "gsc_total"));
    // Per-day top 100 queries/pages by clicks: ask for date+dim and keep the top rows per date.
    for (const [dim, source] of [["query", "gsc_query"], ["page", "gsc_page"]] as const) {
      const r = await client.query(c.site_url, { ...base, dimensions: ["date", dim], rowLimit: 25000 });
      const perDay = new Map<string, GscRow[]>();
      for (const row of r.rows) (perDay.get(row.keys[0]) ?? perDay.set(row.keys[0], []).get(row.keys[0])!).push(row);
      for (const rows of perDay.values()) out.push(...mapGsc(rows.sort((a, b) => b.clicks - a.clicks).slice(0, 100), source));
    }
    // Which page ranks for which query (top 3 pages per query per day) — feeds keyword enrichment and cannibalization.
    const qp = await client.query(c.site_url, { ...base, dimensions: ["date", "query", "page"], rowLimit: 25000 });
    const perDayQuery = new Map<string, GscRow[]>();
    for (const row of qp.rows) {
      const k = `${row.keys[0]}\u0000${row.keys[1]}`;
      (perDayQuery.get(k) ?? perDayQuery.set(k, []).get(k)!).push(row);
    }
    for (const rows of perDayQuery.values()) {
      for (const r of rows.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 3)) {
        out.push({ source: "gsc_query_page", date: r.keys[0], dim: `${r.keys[1]}|${r.keys[2]}`, metrics: { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position } });
      }
    }
  }
  return out;
}

async function syncMetaAds(brandId: string, c: NonNullable<BrandMetricConnections["meta_ads"]>, client: MetaAdsClient, w: Window): Promise<MetricRow[]> {
  const out: MetricRow[] = [];
  for (const chunk of chunkWindow(w)) {
    const [camp, acct] = await Promise.all([
      client.insights(c.ad_account_id, c.access_token, { since: chunk.start, until: chunk.end, level: "campaign" }),
      client.insights(c.ad_account_id, c.access_token, { since: chunk.start, until: chunk.end, level: "account" }),
    ]);
    out.push(...mapMetaCampaigns(camp), ...mapMetaTotals(acct));
  }
  return out;
}

/** Syncs every connected source for a brand independently; one failing source never blocks the others. */
export async function syncBrand(brandId: string, conns: BrandMetricConnections, deps: SyncDeps, opts: { backfill?: Partial<Record<SyncSource, boolean>> } = {}): Promise<SyncResult> {
  const result: SyncResult = { ga4: { ok: true, rows: 0, skipped: true }, gsc: { ok: true, rows: 0, skipped: true }, meta_ads: { ok: true, rows: 0, skipped: true } };
  const run = async (source: SyncSource, lag: number, fn: (w: Window) => Promise<MetricRow[]>) => {
    const backfill = Boolean(opts.backfill?.[source]);
    const w = syncWindow({ backfill, today: deps.today, lagDays: lag, lookbackDays: LOOKBACK_DAYS, backfillDays: BACKFILL_DAYS });
    try {
      const rows = await fn(w);
      await deps.store.upsertRows(brandId, rows);
      await deps.store.recordRun(brandId, source, { ok: true, backfilled: backfill || undefined });
      result[source] = { ok: true, rows: rows.length };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await deps.store.recordRun(brandId, source, { ok: false, error });
      result[source] = { ok: false, rows: 0, error };
    }
  };
  if (conns.ga4 && deps.ga4) await run("ga4", 1, (w) => syncGa4(brandId, conns.ga4!, deps.ga4!, w));
  if (conns.gsc && deps.gsc) await run("gsc", GSC_LAG_DAYS, (w) => syncGsc(brandId, conns.gsc!, deps.gsc!, w));
  if (conns.meta_ads && deps.metaAds) await run("meta_ads", 1, (w) => syncMetaAds(brandId, conns.meta_ads!, deps.metaAds!, w));
  return result;
}
