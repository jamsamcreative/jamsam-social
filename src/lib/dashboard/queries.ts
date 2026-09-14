import { createServerSupabase } from "@/lib/supabase/server";
import { listBrands, type Brand } from "@/lib/brands/queries";
import { PROVIDER_ORDER, type Provider } from "@/lib/connections";
import { countJobsByStatus } from "@/lib/jobs/queries";
import type { Database } from "@/lib/database.types";

type ConnectionStatus = Database["public"]["Enums"]["connection_status"];
export type DashboardBrand = Brand & {
  connections: Record<Provider, ConnectionStatus | "missing">;
  media_count: number;
  pending_approval_count: number;
  next_scheduled: { at: string; title: string } | null;
  article_draft_count: number;
  jobs: { running: number; failed: number };
};

export async function getDashboardBrands(): Promise<DashboardBrand[]> {
  const supabase = await createServerSupabase();
  const brands = await listBrands();
  const ids = brands.map((b) => b.id);
  if (ids.length === 0) return [];

  const nowIso = new Date().toISOString();
  const [{ data: conns, error: cErr }, { data: media, error: mErr }, { data: pendingPosts }, { data: upcoming }, { data: draftArticles }] = await Promise.all([
    supabase.from("brand_connections").select("brand_id,provider,status").in("brand_id", ids),
    supabase.from("media_assets").select("brand_id").in("brand_id", ids),
    supabase.from("posts").select("brand_id").in("brand_id", ids).eq("status", "pending_approval"),
    supabase
      .from("post_targets")
      .select("scheduled_at, post:posts!inner(brand_id,title,status)")
      .eq("status", "pending")
      .in("post.brand_id", ids)
      .in("post.status", ["approved", "publishing"])
      .gte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true }),
    supabase.from("articles").select("brand_id").in("brand_id", ids).eq("status", "draft"),
  ]);
  if (cErr) throw new Error(cErr.message);
  if (mErr) throw new Error(mErr.message);
  const jobCounts = await countJobsByStatus(ids);
  type Up = { scheduled_at: string | null; post: { brand_id: string; title: string } };

  return brands.map((b) => {
    const connections = Object.fromEntries(PROVIDER_ORDER.map((p) => [p, "missing"])) as DashboardBrand["connections"];
    for (const c of conns ?? []) if (c.brand_id === b.id) connections[c.provider as Provider] = c.status;
    const media_count = (media ?? []).filter((m) => m.brand_id === b.id).length;
    const pending_approval_count = (pendingPosts ?? []).filter((p) => p.brand_id === b.id).length;
    const nextUp = ((upcoming ?? []) as unknown as Up[]).find((u) => u.post.brand_id === b.id && u.scheduled_at);
    const next_scheduled = nextUp ? { at: nextUp.scheduled_at!, title: nextUp.post.title } : null;
    const article_draft_count = (draftArticles ?? []).filter((a) => a.brand_id === b.id).length;
    return { ...b, connections, media_count, pending_approval_count, next_scheduled, article_draft_count, jobs: jobCounts[b.id] ?? { running: 0, failed: 0 } };
  });
}
