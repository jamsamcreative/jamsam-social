import { createAdminSupabase } from "@/lib/supabase/admin";
import { withPinterestToken } from "@/lib/pinterest/token";
import { pinAnalytics } from "@/lib/pinterest/client";
import type { Json } from "@/lib/database.types";

/** Lifetime analytics for pins published in the last 90 days, one brand token at a time. */
export async function runPinInsightsCycle(opts: { pinId?: string } = {}): Promise<{ updated: number; failed: number }> {
  const admin = createAdminSupabase();
  let q = admin.from("pins").select("id,brand_id,external_id,published_at").eq("status", "published").not("external_id", "is", null);
  if (opts.pinId) q = q.eq("id", opts.pinId);
  else q = q.gte("published_at", new Date(Date.now() - 90 * 86_400_000).toISOString());
  const { data: pins, error } = await q;
  if (error) throw new Error(error.message);
  const tokens = new Map<string, string | null>();
  const counts = { updated: 0, failed: 0 };
  const end = new Date().toISOString().slice(0, 10);
  for (const p of pins ?? []) {
    if (!tokens.has(p.brand_id)) tokens.set(p.brand_id, await withPinterestToken(p.brand_id).then((t) => t?.token ?? null).catch(() => null));
    const token = tokens.get(p.brand_id);
    if (!token || !p.external_id) { counts.failed++; continue; }
    try {
      const start = (p.published_at ?? end).slice(0, 10);
      const ins = await pinAnalytics(token, p.external_id, start, end);
      await admin.from("pins").update({ insights: ins as unknown as Json, insights_fetched_at: ins.fetched_at }).eq("id", p.id);
      counts.updated++;
    } catch {
      counts.failed++;
    }
  }
  return counts;
}
