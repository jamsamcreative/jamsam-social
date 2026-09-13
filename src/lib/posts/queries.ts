import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type Post = Database["public"]["Tables"]["posts"]["Row"];
export type PostTarget = Database["public"]["Tables"]["post_targets"]["Row"];
export type PostWithTargets = Post & { targets: PostTarget[]; brand: { slug: string; name: string; timezone: string } };

const SELECT = "*, targets:post_targets(*), brand:brands(slug,name,timezone)";

export async function listPosts(opts: { brandId?: string; status?: Post["status"][]; limit?: number } = {}): Promise<PostWithTargets[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from("posts").select(SELECT).order("created_at", { ascending: false }).limit(opts.limit ?? 100);
  if (opts.brandId) q = q.eq("brand_id", opts.brandId);
  if (opts.status?.length) q = q.in("status", opts.status);
  else q = q.neq("status", "archived");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as unknown as PostWithTargets[];
}

export async function getPost(id: string): Promise<PostWithTargets | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("posts").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as PostWithTargets | null;
}

export type CalendarTarget = PostTarget & { post: { id: string; title: string; status: Post["status"]; brand_id: string } };

export async function listTargetsInRange(brandId: string, fromIso: string, toIso: string): Promise<CalendarTarget[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("post_targets")
    .select("*, post:posts!inner(id,title,status,brand_id)")
    .eq("post.brand_id", brandId)
    .neq("post.status", "archived")
    .gte("scheduled_at", fromIso)
    .lt("scheduled_at", toIso);
  if (error) throw new Error(error.message);
  return data as unknown as CalendarTarget[];
}
