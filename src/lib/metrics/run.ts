import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import { serviceAccount, googleAccessToken, GA4_SCOPE, GSC_SCOPE } from "@/lib/google/auth";
import { ga4RunReport } from "@/lib/google/ga4";
import { gscQuery } from "@/lib/google/gsc";
import { metaAdInsights } from "@/lib/meta/ads";
import type { Ga4Config } from "@/lib/connections/google-analytics";
import type { GscConfig } from "@/lib/connections/search-console";
import type { MetaAdsConfig, MetaAdsSecret } from "@/lib/connections/meta-ads";
import { syncBrand, type BrandMetricConnections, type MetricsStore, type SyncResult, type SyncSource } from "./sync";
import type { Json } from "@/lib/database.types";

export function createMetricsStore(admin = createAdminSupabase()): MetricsStore {
  return {
    async upsertRows(brandId, rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500).map((r) => ({ brand_id: brandId, source: r.source, date: r.date, dim: r.dim, metrics: r.metrics as Json, extra: (r.extra ?? null) as Json, synced_at: new Date().toISOString() }));
        const { error } = await admin.from("metrics_daily").upsert(batch, { onConflict: "brand_id,source,date,dim" });
        if (error) throw new Error(error.message);
      }
    },
    async recordRun(brandId, source, patch) {
      const now = new Date().toISOString();
      const row: Record<string, unknown> = { brand_id: brandId, source, last_run_at: now, last_error: patch.ok ? null : (patch.error ?? "unknown error") };
      if (patch.ok) row.last_ok_at = now;
      if (patch.backfilled) row.backfilled = true;
      const { error } = await admin.from("sync_runs").upsert(row as never, { onConflict: "brand_id,source" });
      if (error) throw new Error(error.message);
    },
  };
}

/** Reads the brand's metric connections (decrypted) into the shape the sync engine wants. */
export async function loadBrandMetricConnections(brandId: string): Promise<BrandMetricConnections> {
  const out: BrandMetricConnections = {};
  const [ga4, gsc, meta] = await Promise.all([
    getConnectionWithSecret<Ga4Config, Record<string, never>>(brandId, "google_analytics"),
    getConnectionWithSecret<GscConfig, Record<string, never>>(brandId, "search_console"),
    getConnectionWithSecret<MetaAdsConfig, MetaAdsSecret>(brandId, "meta_ads"),
  ]);
  if (ga4) out.ga4 = { property_id: ga4.config.property_id, lead_events: ga4.config.lead_events ?? [], ads_linked: ga4.config.ads_linked };
  if (gsc) out.gsc = { site_url: gsc.config.site_url };
  if (meta) out.meta_ads = { ad_account_id: meta.config.ad_account_id, access_token: meta.secret.access_token };
  return out;
}

/** Real clients; Google ones only when the service account is configured. */
async function realDeps() {
  const admin = createAdminSupabase();
  const hasSa = Boolean(serviceAccount());
  const ga4Token = hasSa ? await googleAccessToken([GA4_SCOPE]) : null;
  const gscToken = hasSa ? await googleAccessToken([GSC_SCOPE]) : null;
  return {
    store: createMetricsStore(admin),
    ga4: ga4Token ? { runReport: (p: string, body: Parameters<typeof ga4RunReport>[1]) => ga4RunReport(p, body, { token: ga4Token }) } : undefined,
    gsc: gscToken ? { query: (s: string, body: Parameters<typeof gscQuery>[1]) => gscQuery(s, body, { token: gscToken }) } : undefined,
    metaAds: { insights: (a: string, t: string, o: Parameters<typeof metaAdInsights>[2]) => metaAdInsights(a, t, o) },
    today: new Date().toISOString().slice(0, 10),
  };
}

/** Backfill any source that has never completed a full backfill. */
async function backfillFlags(brandId: string): Promise<Partial<Record<SyncSource, boolean>>> {
  const { data } = await createAdminSupabase().from("sync_runs").select("source,backfilled").eq("brand_id", brandId);
  const done = new Set((data ?? []).filter((r) => r.backfilled).map((r) => r.source));
  return { ga4: !done.has("ga4"), gsc: !done.has("gsc"), meta_ads: !done.has("meta_ads") };
}

export async function syncBrandMetrics(brandId: string): Promise<SyncResult> {
  const conns = await loadBrandMetricConnections(brandId);
  const deps = await realDeps();
  return syncBrand(brandId, conns, deps, { backfill: await backfillFlags(brandId) });
}

/** Every active brand with at least one metrics connection, sequentially (the cron has 300s). */
export async function runMetricsCycle(): Promise<Record<string, SyncResult>> {
  const admin = createAdminSupabase();
  const { data } = await admin.from("brand_connections").select("brand_id, brands!inner(active)").in("provider", ["google_analytics", "search_console", "meta_ads"]).eq("brands.active", true);
  const brandIds = [...new Set((data ?? []).map((r) => r.brand_id))];
  const out: Record<string, SyncResult> = {};
  for (const id of brandIds) out[id] = await syncBrandMetrics(id);
  return out;
}
