import { fetchHistoryPage } from "@/lib/meta/history";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import type { MetaConfig, MetaSecret } from "@/lib/connections/meta";
import type { PlanStore } from "./store";

type Conn = { config: { page_id: string; ig_user_id?: string | null }; secret: { page_access_token: string } } | null;

/** One Graph page of history for a brand+platform. Pass `connection` to skip the DB lookup (tests). */
export async function importHistoryChunk(store: PlanStore, i: { brandId: string; platform: "facebook" | "instagram"; since?: string; fetchImpl?: typeof fetch; connection?: Conn }): Promise<{ imported: number; done: boolean }> {
  const conn = i.connection === undefined ? await getConnectionWithSecret<MetaConfig, MetaSecret>(i.brandId, "meta") : i.connection;
  if (!conn) throw new Error("Connect Meta on the brand before importing history");
  const cursor = await store.getHistoryCursor(i.brandId);
  const page = await fetchHistoryPage({ platform: i.platform, token: conn.secret.page_access_token, pageId: conn.config.page_id, igUserId: conn.config.ig_user_id ?? undefined, cursorUrl: cursor[i.platform] ?? null, since: i.since, fetchImpl: i.fetchImpl });
  const imported = await store.upsertHistory(i.brandId, page.rows);
  const done = page.next === null;
  await store.setHistoryCursor(i.brandId, { ...cursor, [i.platform]: page.next }, done);
  return { imported, done };
}

/** Nightly: last 30 days for every active brand with Meta connected; one page per platform is plenty for a daily delta. */
export async function topUpHistoryForAllBrands(store: PlanStore): Promise<{ brands: number; imported: number }> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  let brands = 0, imported = 0;
  for (const b of await store.listActiveBrands()) {
    try {
      const conn = await getConnectionWithSecret<MetaConfig, MetaSecret>(b.id, "meta");
      if (!conn) continue;
      brands++;
      // Top-ups start fresh (no cursor) so they never resume a stale backfill URL.
      const cursor = await store.getHistoryCursor(b.id);
      await store.setHistoryCursor(b.id, { ...cursor, facebook: null, instagram: null }, false);
      for (const platform of ["facebook", "instagram"] as const) {
        try { imported += (await importHistoryChunk(store, { brandId: b.id, platform, since, connection: conn })).imported; } catch { /* one platform failing shouldn't skip the other */ }
      }
    } catch { /* one brand's connection/cursor error must not stop the rest of the cycle */ }
  }
  return { brands, imported };
}

export async function mirrorPublishedTarget(store: PlanStore, i: { brandId: string; postId: string; platform: "facebook" | "instagram"; externalId: string; externalUrl: string | null; caption: string; media: { url: string }[]; publishedAt: string }): Promise<void> {
  await store.upsertHistory(i.brandId, [{ platform: i.platform, external_id: i.externalId, published_at: i.publishedAt, caption: i.caption, media: i.media.map((m) => ({ url: m.url, kind: "image" as const })), permalink: i.externalUrl, likes: 0, comments: 0, shares: 0, reach: null }], i.postId);
}
