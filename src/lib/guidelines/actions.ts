"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { isGuidelineKind, type GuidelineKind } from "./kinds";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveGuideline(
  brandId: string,
  kind: GuidelineKind,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  if (!isGuidelineKind(kind)) return { ok: false, error: "Unknown guideline kind" };
  const body_md = String(formData.get("body_md") ?? "");

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { error } = await supabase
    .from("brand_guidelines")
    .upsert({ brand_id: brandId, kind, body_md, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "brand_id,kind" });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/brands`, "layout");
  return { ok: true };
}
