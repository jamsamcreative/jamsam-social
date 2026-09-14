import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type PostCategory = Database["public"]["Tables"]["post_categories"]["Row"];

export async function listCategories(brandId: string): Promise<PostCategory[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("post_categories").select("*").eq("brand_id", brandId).order("sort_order");
  if (error) throw new Error(error.message);
  return data.map((c) => ({ ...c, target_share: Number(c.target_share) }));
}
