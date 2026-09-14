import { listMediaAssets } from "@/lib/media/queries";
import { listBoards } from "./queries";
import { createServerSupabase } from "@/lib/supabase/server";
import type { ProjectOption } from "@/components/pins/pin-form";

/** Everything the pin form needs for a brand. */
export async function pinFormData(brandId: string): Promise<{ assets: Awaited<ReturnType<typeof listMediaAssets>>; boards: Awaited<ReturnType<typeof listBoards>>; projects: ProjectOption[] }> {
  const supabase = await createServerSupabase();
  const [assets, boards, { data: projects }] = await Promise.all([listMediaAssets(brandId), listBoards(brandId), supabase.from("projects").select("id,title,url,images,dims,location").eq("brand_id", brandId).order("imported_at", { ascending: false }).limit(300)]);
  return { assets, boards, projects: (projects ?? []).map((p) => ({ id: p.id, title: p.title, url: p.url, image_url: ((p.images as { url: string }[] | null) ?? [])[0]?.url ?? null, dims: p.dims, location: p.location })) };
}
