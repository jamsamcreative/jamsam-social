import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type KeywordRow = Database["public"]["Tables"]["keywords"]["Row"];
export type SitePageRow = Database["public"]["Tables"]["site_pages"]["Row"];
export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
export type ImportRow = Database["public"]["Tables"]["keyword_imports"]["Row"];

export async function listKeywordsForBrand(brandId: string): Promise<KeywordRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("keywords").select("*").eq("brand_id", brandId).order("keyword").limit(5000);
  if (error) throw new Error(error.message);
  return data;
}
export async function listSitePagesForBrand(brandId: string): Promise<SitePageRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("site_pages").select("*").eq("brand_id", brandId).order("title").limit(2000);
  if (error) throw new Error(error.message);
  return data;
}
export async function listProjectsForBrand(brandId: string, opts: { q?: string; category?: string; state?: string }): Promise<{ rows: ProjectRow[]; categories: string[]; states: string[] }> {
  const supabase = await createServerSupabase();
  let q = supabase.from("projects").select("*").eq("brand_id", brandId).order("imported_at", { ascending: false }).limit(60);
  if (opts.category) q = q.eq("category", opts.category);
  if (opts.state) q = q.eq("state", opts.state);
  if (opts.q) q = q.textSearch("search", opts.q, { type: "websearch", config: "english" });
  const [{ data, error }, { data: facets }] = await Promise.all([q, supabase.from("projects").select("category,state").eq("brand_id", brandId).limit(5000)]);
  if (error) throw new Error(error.message);
  const categories = [...new Set((facets ?? []).map((f) => f.category).filter((c): c is string => Boolean(c)))].sort();
  const states = [...new Set((facets ?? []).map((f) => f.state).filter((c): c is string => Boolean(c)))].sort();
  return { rows: data, categories, states };
}
export async function listImportsForBrand(brandId: string): Promise<ImportRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("keyword_imports").select("*").eq("brand_id", brandId).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return data;
}
export async function listArticleTargets(brandId: string) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("articles").select("id,title,slug,status,primary_keyword,secondary_keywords,wp_link").eq("brand_id", brandId).neq("status", "archived");
  if (error) throw new Error(error.message);
  return data;
}
