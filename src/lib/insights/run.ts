import { createAdminSupabase } from "@/lib/supabase/admin";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import type { MetaConfig, MetaSecret } from "@/lib/connections/meta";
import type { Json } from "@/lib/database.types";
import { fetchFacebookInsights, fetchInstagramInsights } from "./fetch";

export async function runInsightsCycle(opts: { postId?: string } = {}): Promise<{ updated: number; failed: number }> {
  const admin = createAdminSupabase();
  let q = admin.from("post_targets").select("id,post_id,platform,external_id,post:posts!inner(brand_id)").eq("status", "published").not("external_id", "is", null);
  if (opts.postId) q = q.eq("post_id", opts.postId);
  else q = q.gte("published_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
  const { data: targets, error } = await q;
  if (error) throw new Error(error.message);

  const tokens = new Map<string, { config: MetaConfig; secret: MetaSecret } | null>();
  const counts = { updated: 0, failed: 0 };
  for (const t of targets ?? []) {
    const brandId = (t.post as unknown as { brand_id: string }).brand_id;
    if (!tokens.has(brandId)) tokens.set(brandId, await getConnectionWithSecret<MetaConfig, MetaSecret>(brandId, "meta"));
    const conn = tokens.get(brandId);
    if (!conn || !t.external_id) {
      counts.failed++;
      continue;
    }
    try {
      const ins = t.platform === "facebook" ? await fetchFacebookInsights(t.external_id, conn.secret.page_access_token) : await fetchInstagramInsights(t.external_id, conn.secret.page_access_token);
      await admin.from("post_targets").update({ insights: ins as unknown as Json, insights_fetched_at: ins.fetched_at }).eq("id", t.id);
      counts.updated++;
    } catch {
      counts.failed++;
    }
  }
  return counts;
}
