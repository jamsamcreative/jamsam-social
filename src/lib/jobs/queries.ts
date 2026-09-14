import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type GenerationJob = Database["public"]["Tables"]["generation_jobs"]["Row"];

export async function listJobsForBrand(brandId: string): Promise<GenerationJob[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("generation_jobs").select("*").eq("brand_id", brandId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data;
}

export async function getJobPublic(id: string): Promise<Pick<GenerationJob, "id" | "status" | "result" | "error" | "post_id" | "article_id"> | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("generation_jobs").select("id,status,result,error,post_id,article_id").eq("id", id).maybeSingle();
  return data ?? null;
}

export async function countJobsByStatus(brandIds: string[]): Promise<Record<string, { running: number; failed: number }>> {
  if (brandIds.length === 0) return {};
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("generation_jobs").select("brand_id,status").in("brand_id", brandIds).in("status", ["queued", "claimed", "running", "failed"]);
  const out: Record<string, { running: number; failed: number }> = {};
  for (const r of data ?? []) {
    out[r.brand_id] ??= { running: 0, failed: 0 };
    if (r.status === "failed") out[r.brand_id].failed++;
    else out[r.brand_id].running++;
  }
  return out;
}
