"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { categoryInputSchema, toRow, checkTotal } from "./schema";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function guard() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase } : null;
}

export async function saveCategory(brandId: string, id: string | null, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const g = await guard();
  if (!g) return { ok: false, error: "Not signed in" };
  const parsed = categoryInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid category" };
  const row = toRow(parsed.data);
  const { data: existing } = await g.supabase.from("post_categories").select("id,target_share").eq("brand_id", brandId);
  const err = checkTotal((existing ?? []).map((c) => ({ id: c.id, target_share: Number(c.target_share) })), { id: id ?? undefined, target_share: row.target_share });
  if (err) return { ok: false, error: err };
  const { error } = id
    ? await g.supabase.from("post_categories").update(row).eq("id", id)
    : await g.supabase.from("post_categories").insert({ ...row, brand_id: brandId });
  if (error) return { ok: false, error: error.message.includes("unique") ? "A category with that name already exists" : error.message };
  revalidatePath("/brands", "layout");
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g) return { ok: false, error: "Not signed in" };
  const { error } = await g.supabase.from("post_categories").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/brands", "layout");
  return { ok: true };
}
