import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import { createWpClient } from "@/lib/wordpress/client";
import type { WordpressConfig, WordpressSecret } from "@/lib/connections/wordpress-shared";
import { createSupabaseStore, type Store } from "@/lib/ai/store";
import { mirrorSite } from "./mirror";
import { enrichFromGsc } from "./gsc-enrich";

/** Mirror the brand's published WP pages into site_pages (replace-all semantics). */
export async function mirrorBrandSite(brandId: string, store: Store = createSupabaseStore()): Promise<{ pages: number } | { error: string }> {
  const conn = await getConnectionWithSecret<WordpressConfig, WordpressSecret>(brandId, "wordpress");
  if (!conn) return { error: "WordPress is not connected" };
  const admin = createAdminSupabase();
  try {
    const pages = await mirrorSite(createWpClient(conn.config, conn.secret));
    const now = new Date().toISOString();
    for (let i = 0; i < pages.length; i += 200) {
      const { error } = await admin.from("site_pages").upsert(pages.slice(i, i + 200).map((p) => ({ brand_id: brandId, ...p, mirrored_at: now })), { onConflict: "brand_id,type,wp_id" });
      if (error) throw new Error(error.message);
    }
    await admin.from("site_pages").delete().eq("brand_id", brandId).lt("mirrored_at", now);
    await store.logImport(brandId, "site_mirror", conn.config.site_url, pages.length);
    return { pages: pages.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fold the last 28 days of Search Console data onto keywords; surface unseen queries with ≥ 20 impressions. */
export async function enrichBrandFromGsc(brandId: string, store: Store = createSupabaseStore()): Promise<{ updated: number }> {
  const end = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const start = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
  const admin = createAdminSupabase();
  const read = async (source: "gsc_query" | "gsc_query_page") => {
    const { data } = await admin.from("metrics_daily").select("source,date,dim,metrics").eq("brand_id", brandId).eq("source", source).gte("date", start).lte("date", end).limit(50000);
    return (data ?? []).map((r) => ({ source: r.source, date: r.date, dim: r.dim, metrics: r.metrics as Record<string, number> }));
  };
  const [q, qp] = await Promise.all([read("gsc_query"), read("gsc_query_page")]);
  if (q.length === 0) return { updated: 0 };
  const rows = enrichFromGsc(q, qp, { minImpressions: 20 }).map((e) => ({ ...e, source: "gsc" as const }));
  const updated = await store.upsertKeywords(brandId, rows, { onlyOurFields: true });
  await store.logImport(brandId, "gsc_refresh", null, updated);
  return { updated };
}

/** Nightly: mirror sites with WordPress, enrich keywords for brands with GSC rows. Called from the metrics cron. */
export async function runSeoCycle(): Promise<Record<string, { mirror?: unknown; gsc?: unknown }>> {
  const admin = createAdminSupabase();
  const { data } = await admin.from("brand_connections").select("brand_id,provider, brands!inner(active)").in("provider", ["wordpress", "search_console"]).eq("brands.active", true);
  const out: Record<string, { mirror?: unknown; gsc?: unknown }> = {};
  const store = createSupabaseStore();
  for (const r of data ?? []) {
    out[r.brand_id] ??= {};
    if (r.provider === "wordpress") out[r.brand_id].mirror = await mirrorBrandSite(r.brand_id, store);
    if (r.provider === "search_console") out[r.brand_id].gsc = await enrichBrandFromGsc(r.brand_id, store);
  }
  return out;
}

