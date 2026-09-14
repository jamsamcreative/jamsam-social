"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { AI_MODELS } from "./models";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function setAiModel(model: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(AI_MODELS as readonly string[]).includes(model)) return { ok: false, error: "Unknown model" };
  const { error } = await createAdminSupabase().from("app_settings").upsert({ key: "ai_model", value: model });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}
