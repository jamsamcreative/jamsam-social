import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type Brand = Database["public"]["Tables"]["brands"]["Row"];

export async function listBrands(opts: { includeArchived?: boolean } = {}): Promise<Brand[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from("brands").select("*").order("name");
  if (!opts.includeArchived) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

export async function getBrandBySlug(slug: string): Promise<Brand | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("brands").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
