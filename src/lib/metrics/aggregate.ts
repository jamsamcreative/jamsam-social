import { bucketOf, type Window } from "./ranges";
import { isPaid, PLATFORM_CHANNEL } from "./channels";
import { TOTAL_DIM, type MetricRow, type MetricSource } from "./types";

export const sumMetric = (rows: MetricRow[], key: string) => rows.reduce((s, r) => s + (r.metrics[key] ?? 0), 0);
export const ofSource = (rows: MetricRow[], source: MetricSource) => rows.filter((r) => r.source === source);
export const totals = (rows: MetricRow[], source: MetricSource) => rows.filter((r) => r.source === source && r.dim === TOTAL_DIM);

/** null when there are no leads — rendered as "—", never "$0". */
export function costPerLead(cost: number, leads: number): number | null {
  return leads > 0 ? cost / leads : null;
}
/** Percent change; null when the previous value is 0 (a change from nothing is not a percentage). */
export function pctChange(cur: number, prev: number): number | null {
  return prev > 0 ? ((cur - prev) / prev) * 100 : null;
}
export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type DimTotal = { dim: string; label: string; metrics: Record<string, number> };
/** Sums every metric per dimension value, sorted by `sortKey` desc. */
export function byDim(rows: MetricRow[], sortKey: string): DimTotal[] {
  const map = new Map<string, DimTotal>();
  for (const r of rows) {
    const cur = map.get(r.dim) ?? { dim: r.dim, label: r.extra?.campaign_name ?? r.dim, metrics: {} };
    for (const [k, v] of Object.entries(r.metrics)) cur.metrics[k] = (cur.metrics[k] ?? 0) + v;
    map.set(r.dim, cur);
  }
  return [...map.values()].sort((a, b) => (b.metrics[sortKey] ?? 0) - (a.metrics[sortKey] ?? 0));
}
/** Weighted position/ctr need impressions: recompute after summing. */
export function fixGscAverages(d: DimTotal, rows: MetricRow[]): DimTotal {
  const mine = rows.filter((r) => r.dim === d.dim);
  const imps = sumMetric(mine, "impressions");
  const clicks = sumMetric(mine, "clicks");
  const pos = imps > 0 ? mine.reduce((s, r) => s + (r.metrics.position ?? 0) * (r.metrics.impressions ?? 0), 0) / imps : 0;
  return { ...d, metrics: { ...d.metrics, ctr: imps > 0 ? clicks / imps : 0, position: pos } };
}

export type BucketPoint = { bucket: string; value: number };
export function byBucket(rows: MetricRow[], mode: "week" | "month", key: string, w: Window): BucketPoint[] {
  const map = new Map<string, number>();
  // Seed every bucket in the window so charts show zero months instead of gaps.
  for (let d = w.start; d <= w.end; ) {
    const b = bucketOf(d, mode);
    if (!map.has(b)) map.set(b, 0);
    d = new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10);
  }
  for (const r of rows) {
    const b = bucketOf(r.date, mode);
    map.set(b, (map.get(b) ?? 0) + (r.metrics[key] ?? 0));
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([bucket, value]) => ({ bucket, value }));
}

export type Tile = { label: string; value: number | null; prev: number | null; change: number | null; sub?: string; format: "money" | "int" | "pct" | "pos" };
export type OverviewVM = {
  tiles: Tile[];
  spendByBucket: { bucket: string; meta: number; google: number }[];
  byPlatform: { platform: "Meta ads" | "Google Ads"; spend: number; clicks: number; ctr: number | null; cpc: number | null; arrived: number | null; leads: number; cpl: number | null; campaigns: number }[];
  metaCampaigns: { name: string; spend: number; clicks: number; ctr: number | null; leads: number; cpl: number | null }[];
  adsCampaigns: { name: string; spend: number; clicks: number; ctr: number | null; leads: number; cpl: number | null }[];
  channels: { channel: string; sessions: number; share: number; paid: boolean; prev: number; change: number | null; lastYear: number | null; lyChange: number | null }[];
  paidVsEarned: { bucket: string; paid: number; earned: number }[];
  hasAds: boolean;
  hasGa4: boolean;
};

export function buildOverview(input: { cur: MetricRow[]; prev: MetricRow[]; ly: MetricRow[]; window: Window; mode: "week" | "month" }): OverviewVM {
  const { cur, prev, ly, window, mode } = input;
  const metaCur = totals(cur, "meta_ads_total"), metaPrev = totals(prev, "meta_ads_total");
  const gaCur = totals(cur, "ga4_total"), gaPrev = totals(prev, "ga4_total");
  const metaSpend = sumMetric(metaCur, "spend"), metaSpendPrev = sumMetric(metaPrev, "spend");
  const metaLeads = sumMetric(metaCur, "leads"), metaLeadsPrev = sumMetric(metaPrev, "leads");
  const gSpend = sumMetric(gaCur, "google_ads_cost"), gSpendPrev = sumMetric(gaPrev, "google_ads_cost");
  const gClicks = sumMetric(gaCur, "google_ads_clicks");
  const adsCampCur = ofSource(cur, "ga4_campaign");
  const gLeads = sumMetric(adsCampCur, "leads"), gLeadsPrev = sumMetric(ofSource(prev, "ga4_campaign"), "leads");
  const webLeads = sumMetric(gaCur, "leads"), webLeadsPrev = sumMetric(gaPrev, "leads");
  const hasAds = metaCur.length > 0 || gSpend > 0;
  const hasGa4 = gaCur.length > 0;

  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const tiles: Tile[] = [
    { label: "Ad spend", value: metaSpend + gSpend, prev: metaSpendPrev + gSpendPrev, change: pctChange(metaSpend + gSpend, metaSpendPrev + gSpendPrev), sub: `Meta ${money(metaSpend)} · Google ${money(gSpend)}`, format: "money" },
    { label: "Meta ads cost / lead", value: costPerLead(metaSpend, metaLeads), prev: costPerLead(metaSpendPrev, metaLeadsPrev), change: null, sub: `${metaLeads} lead${metaLeads === 1 ? "" : "s"} on ${money(metaSpend)}`, format: "money" },
    { label: "Google Ads cost / lead", value: costPerLead(gSpend, gLeads), prev: costPerLead(gSpendPrev, gLeadsPrev), change: null, sub: `${gLeads} lead${gLeads === 1 ? "" : "s"} on ${money(gSpend)}`, format: "money" },
    { label: "Website leads", value: webLeads, prev: webLeadsPrev, change: pctChange(webLeads, webLeadsPrev), sub: "GA4 key events chosen for this brand", format: "int" },
  ];
  for (const t of tiles) if (t.change === null && t.value !== null && t.prev !== null && t.prev > 0) t.change = pctChange(t.value, t.prev);

  const metaB = byBucket(metaCur, mode, "spend", window);
  const gB = byBucket(gaCur, mode, "google_ads_cost", window);
  const spendByBucket = metaB.map((m, i) => ({ bucket: m.bucket, meta: m.value, google: gB[i]?.value ?? 0 }));

  const channelsCur = byDim(ofSource(cur, "ga4_channel"), "sessions");
  const sessionsFor = (rows: MetricRow[], ch: string) => sumMetric(rows.filter((r) => r.source === "ga4_channel" && r.dim === ch), "sessions");
  const metaClicks = sumMetric(metaCur, "link_clicks") || sumMetric(metaCur, "clicks");
  const metaImps = sumMetric(metaCur, "impressions");
  const adsImps = sumMetric(adsCampCur, "impressions");
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
  const byPlatform: OverviewVM["byPlatform"] = [];
  if (metaCur.length) byPlatform.push({ platform: "Meta ads", spend: metaSpend, clicks: metaClicks, ctr: ratio(metaClicks, metaImps), cpc: ratio(metaSpend, metaClicks), arrived: ratio(sessionsFor(cur, PLATFORM_CHANNEL.meta), metaClicks), leads: metaLeads, cpl: costPerLead(metaSpend, metaLeads), campaigns: byDim(ofSource(cur, "meta_ads_campaign"), "spend").length });
  if (gSpend > 0) byPlatform.push({ platform: "Google Ads", spend: gSpend, clicks: gClicks, ctr: ratio(gClicks, adsImps), cpc: ratio(gSpend, gClicks), arrived: ratio(sessionsFor(cur, PLATFORM_CHANNEL.google), gClicks), leads: gLeads, cpl: costPerLead(gSpend, gLeads), campaigns: byDim(adsCampCur, "cost").length });

  const camp = (d: DimTotal, spendKey: string) => ({ name: d.label, spend: d.metrics[spendKey] ?? 0, clicks: d.metrics.clicks ?? 0, ctr: ratio(d.metrics.clicks ?? 0, d.metrics.impressions ?? 0), leads: d.metrics.leads ?? 0, cpl: costPerLead(d.metrics[spendKey] ?? 0, d.metrics.leads ?? 0) });
  const metaCampaigns = byDim(ofSource(cur, "meta_ads_campaign"), "spend").map((d) => camp(d, "spend"));
  const adsCampaigns = byDim(adsCampCur, "cost").map((d) => camp(d, "cost"));

  const totalSessions = channelsCur.reduce((s, c) => s + (c.metrics.sessions ?? 0), 0);
  const lyChannels = ofSource(ly, "ga4_channel");
  const channels = channelsCur.map((c) => {
    const p = sessionsFor(prev, c.dim);
    const l = lyChannels.length ? sessionsFor(ly, c.dim) : null;
    return { channel: c.dim, sessions: c.metrics.sessions ?? 0, share: totalSessions > 0 ? (c.metrics.sessions ?? 0) / totalSessions : 0, paid: isPaid(c.dim), prev: p, change: pctChange(c.metrics.sessions ?? 0, p), lastYear: l, lyChange: l === null ? null : pctChange(c.metrics.sessions ?? 0, l) };
  });

  const chRows = ofSource(cur, "ga4_channel");
  const paidB = byBucket(chRows.filter((r) => isPaid(r.dim)), mode, "sessions", window);
  const earnedB = byBucket(chRows.filter((r) => !isPaid(r.dim)), mode, "sessions", window);
  const paidVsEarned = paidB.map((p, i) => ({ bucket: p.bucket, paid: p.value, earned: earnedB[i]?.value ?? 0 }));

  return { tiles, spendByBucket, byPlatform, metaCampaigns, adsCampaigns, channels, paidVsEarned, hasAds, hasGa4 };
}

export type SearchVM = {
  tiles: Tile[];
  series: { bucket: string; clicks: number; impressions: number }[];
  queries: (DimTotal & { prevClicks: number; change: number | null })[];
  pages: (DimTotal & { prevClicks: number; change: number | null })[];
  hasData: boolean;
};

export function buildSearch(input: { cur: MetricRow[]; prev: MetricRow[]; window: Window; mode: "week" | "month" }): SearchVM {
  const { cur, prev, window, mode } = input;
  const tCur = totals(cur, "gsc_total"), tPrev = totals(prev, "gsc_total");
  const clicks = sumMetric(tCur, "clicks"), clicksPrev = sumMetric(tPrev, "clicks");
  const imps = sumMetric(tCur, "impressions"), impsPrev = sumMetric(tPrev, "impressions");
  const wpos = (rows: MetricRow[]) => {
    const i = sumMetric(rows, "impressions");
    return i > 0 ? rows.reduce((s, r) => s + (r.metrics.position ?? 0) * (r.metrics.impressions ?? 0), 0) / i : null;
  };
  const ctr = imps > 0 ? clicks / imps : null, ctrPrev = impsPrev > 0 ? clicksPrev / impsPrev : null;
  const pos = wpos(tCur), posPrev = wpos(tPrev);
  const tiles: Tile[] = [
    { label: "Clicks", value: clicks, prev: clicksPrev, change: pctChange(clicks, clicksPrev), format: "int" },
    { label: "Impressions", value: imps, prev: impsPrev, change: pctChange(imps, impsPrev), format: "int" },
    { label: "CTR", value: ctr, prev: ctrPrev, change: ctr !== null && ctrPrev ? pctChange(ctr, ctrPrev) : null, format: "pct" },
    { label: "Average position", value: pos, prev: posPrev, change: pos !== null && posPrev ? -pctChange(pos, posPrev)! : null, sub: "lower is better", format: "pos" },
  ];
  const c = byBucket(tCur, mode, "clicks", window);
  const i = byBucket(tCur, mode, "impressions", window);
  const series = c.map((x, n) => ({ bucket: x.bucket, clicks: x.value, impressions: i[n]?.value ?? 0 }));
  const top = (source: "gsc_query" | "gsc_page") => {
    const rows = ofSource(cur, source);
    const prevRows = ofSource(prev, source);
    return byDim(rows, "clicks")
      .slice(0, 25)
      .map((d) => fixGscAverages(d, rows))
      .map((d) => {
        const prevClicks = sumMetric(prevRows.filter((r) => r.dim === d.dim), "clicks");
        return { ...d, prevClicks, change: pctChange(d.metrics.clicks ?? 0, prevClicks) };
      });
  };
  return { tiles, series, queries: top("gsc_query"), pages: top("gsc_page"), hasData: tCur.length > 0 };
}
