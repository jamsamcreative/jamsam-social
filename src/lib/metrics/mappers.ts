import type { Ga4Row } from "@/lib/google/ga4";
import type { GscRow } from "@/lib/google/gsc";
import type { MetaInsightRow } from "@/lib/meta/ads";
import { TOTAL_DIM, type MetricRow } from "./types";

const ga4Date = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const sumFrom = (m: number[], from: number) => m.slice(from).reduce((s, x) => s + (x || 0), 0);

/** dims [date, channel]; metrics [sessions, engagedSessions, keyEvents:a, keyEvents:b, …] */
export function mapGa4Channels(rows: Ga4Row[]): MetricRow[] {
  return rows.map((r) => ({ source: "ga4_channel", date: ga4Date(r.dims[0]), dim: r.dims[1] || "(unknown)", metrics: { sessions: r.metrics[0] ?? 0, engaged_sessions: r.metrics[1] ?? 0, leads: sumFrom(r.metrics, 2) } }));
}

/** dims [date]; metrics [sessions, advertiserAdCost, advertiserAdClicks, keyEvents:a, …] */
export function mapGa4Totals(rows: Ga4Row[]): MetricRow[] {
  return rows.map((r) => ({
    source: "ga4_total", date: ga4Date(r.dims[0]), dim: TOTAL_DIM,
    metrics: { sessions: r.metrics[0] ?? 0, google_ads_cost: r.metrics[1] ?? 0, google_ads_clicks: r.metrics[2] ?? 0, leads: sumFrom(r.metrics, 3) },
  }));
}

/** dims [date, sessionGoogleAdsCampaignName]; metrics [advertiserAdCost, advertiserAdClicks, advertiserAdImpressions, sessions, keyEvents:a, …]. Drops unattributed/zero-spend rows. */
export function mapGa4Campaigns(rows: Ga4Row[]): MetricRow[] {
  return rows
    .filter((r) => r.dims[1] && r.dims[1] !== "(not set)" && (r.metrics[0] ?? 0) > 0)
    .map((r) => ({
      source: "ga4_campaign", date: ga4Date(r.dims[0]), dim: r.dims[1],
      metrics: { cost: r.metrics[0] ?? 0, clicks: r.metrics[1] ?? 0, impressions: r.metrics[2] ?? 0, sessions: r.metrics[3] ?? 0, leads: sumFrom(r.metrics, 4) },
      extra: { campaign_name: r.dims[1] },
    }));
}

/** keys [date] (total) or [date, query|page]. */
export function mapGsc(rows: GscRow[], source: "gsc_total" | "gsc_query" | "gsc_page"): MetricRow[] {
  return rows.map((r) => ({
    source, date: r.keys[0], dim: source === "gsc_total" ? TOTAL_DIM : r.keys[1],
    metrics: { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position },
  }));
}

const LEAD_ACTIONS = new Set(["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"]);
function metaLeads(actions?: MetaInsightRow["actions"]): number {
  return (actions ?? []).filter((a) => LEAD_ACTIONS.has(a.action_type)).reduce((s, a) => s + (Number(a.value) || 0), 0);
}
const metaMetrics = (r: MetaInsightRow) => ({ spend: Number(r.spend ?? 0), clicks: Number(r.clicks ?? 0), impressions: Number(r.impressions ?? 0), link_clicks: Number(r.inline_link_clicks ?? 0), leads: metaLeads(r.actions) });

export function mapMetaCampaigns(rows: MetaInsightRow[]): MetricRow[] {
  return rows.filter((r) => r.campaign_id).map((r) => ({ source: "meta_ads_campaign", date: r.date_start, dim: r.campaign_id!, metrics: metaMetrics(r), extra: { campaign_name: r.campaign_name ?? r.campaign_id! } }));
}

export function mapMetaTotals(rows: MetaInsightRow[]): MetricRow[] {
  return rows.map((r) => ({ source: "meta_ads_total", date: r.date_start, dim: TOTAL_DIM, metrics: metaMetrics(r) }));
}
