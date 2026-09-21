"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { brandInputSchema } from "./schema";
import { seoToolsFormSchema } from "./seo-tools";

export type ActionResult = { ok: true } | { ok: false; error: string };

function firstIssue(e: { issues: { message: string }[] }) {
  return e.issues[0]?.message ?? "Invalid input";
}

export async function createBrand(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = brandInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("brands").insert(parsed.data);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That slug is already in use" };
    return { ok: false, error: error.message };
  }
  revalidatePath("/brands");
  redirect(`/brands/${parsed.data.slug}`);
}

export async function updateBrand(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = brandInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("brands").update(parsed.data).eq("id", id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That slug is already in use" };
    return { ok: false, error: error.message };
  }
  revalidatePath("/brands");
  redirect(`/brands/${parsed.data.slug}`);
}

export async function setBrandActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("brands").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/brands");
  revalidatePath("/brands/[slug]", "page");
  return { ok: true };
}

export async function saveSeoTools(brandId: string, slug: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = seoToolsFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("brands").update({ seo_tools: parsed.data }).eq("id", brandId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/brands/${slug}/connections`);
  return { ok: true };
}
