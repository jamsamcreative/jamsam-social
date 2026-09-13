"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { runInsightsCycle } from "./run";

export type ActionResult = { ok: true; updated: number } | { ok: false; error: string };

export async function refreshInsights(postId: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  try {
    const r = await runInsightsCycle({ postId });
    revalidatePath(`/posts/${postId}`);
    revalidatePath("/posts");
    if (r.updated === 0) return { ok: false, error: "No insights available yet" };
    return { ok: true, updated: r.updated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to refresh" };
  }
}
