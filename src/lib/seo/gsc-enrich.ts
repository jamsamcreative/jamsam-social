import type { MetricRow } from "@/lib/metrics/types";
import { normaliseKeyword } from "./score";

export type GscEnrichment = { keyword: string; our_position: number; our_impressions: number; our_clicks: number; our_page: string | null };

/**
 * Aggregates the last N days of gsc_query (impression-weighted position) and gsc_query_page (top page by clicks)
 * into per-keyword facts. `minImpressions` gates which unseen queries are worth surfacing as new keywords.
 */
export function enrichFromGsc(queryRows: MetricRow[], queryPageRows: MetricRow[], opts: { minImpressions?: number } = {}): GscEnrichment[] {
  const min = opts.minImpressions ?? 0;
  const agg = new Map<string, { imps: number; clicks: number; posW: number }>();
  for (const r of queryRows) {
    const k = normaliseKeyword(r.dim);
    const a = agg.get(k) ?? { imps: 0, clicks: 0, posW: 0 };
    a.imps += r.metrics.impressions ?? 0;
    a.clicks += r.metrics.clicks ?? 0;
    a.posW += (r.metrics.position ?? 0) * (r.metrics.impressions ?? 0);
    agg.set(k, a);
  }
  const pages = new Map<string, Map<string, number>>();
  for (const r of queryPageRows) {
    const [q, page] = r.dim.split("|", 2);
    if (!q || !page) continue;
    const k = normaliseKeyword(q);
    const m = pages.get(k) ?? new Map<string, number>();
    m.set(page, (m.get(page) ?? 0) + (r.metrics.clicks ?? 0) + (r.metrics.impressions ?? 0) / 1000);
    pages.set(k, m);
  }
  const out: GscEnrichment[] = [];
  for (const [k, a] of agg) {
    if (a.imps < min) continue;
    const top = [...(pages.get(k) ?? new Map())].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    out.push({ keyword: k, our_position: a.imps ? Math.round((a.posW / a.imps) * 10) / 10 : 0, our_impressions: a.imps, our_clicks: a.clicks, our_page: top });
  }
  return out;
}
