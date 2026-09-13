import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type Article = Database["public"]["Tables"]["articles"]["Row"];
export type ArticleBrand = { slug: string; name: string; timezone: string; seo_suffix: string | null; website_url: string | null };
export type ArticleWithBrand = Article & { brand: ArticleBrand };

const SELECT = "*, brand:brands(slug,name,timezone,seo_suffix,website_url)";

export async function listArticles(opts: { brandId: string; status?: Article["status"][] }): Promise<ArticleWithBrand[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from("articles").select(SELECT).eq("brand_id", opts.brandId).order("updated_at", { ascending: false }).limit(200);
  if (opts.status?.length) q = q.in("status", opts.status);
  else q = q.neq("status", "archived");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as unknown as ArticleWithBrand[];
}

export async function getArticle(id: string): Promise<ArticleWithBrand | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("articles").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as ArticleWithBrand | null;
}
