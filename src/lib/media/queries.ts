import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type MediaAsset = Database["public"]["Tables"]["media_assets"]["Row"];

export async function listMediaAssets(brandId: string, opts: { tag?: string; limit?: number } = {}): Promise<MediaAsset[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from("media_assets")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.tag) q = q.contains("tags", [opts.tag]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}
