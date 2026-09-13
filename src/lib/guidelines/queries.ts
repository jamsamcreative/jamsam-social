import { createServerSupabase } from "@/lib/supabase/server";
import { GUIDELINE_KINDS, type GuidelineKind } from "./kinds";

export async function getGuidelines(brandId: string): Promise<Record<GuidelineKind, string>> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("brand_guidelines").select("kind,body_md").eq("brand_id", brandId);
  if (error) throw new Error(error.message);
  const out = Object.fromEntries(GUIDELINE_KINDS.map((k) => [k.kind, ""])) as Record<GuidelineKind, string>;
  for (const row of data) out[row.kind] = row.body_md;
  return out;
}
