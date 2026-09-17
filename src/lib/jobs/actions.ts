"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseJobInput, type JobType, type JobRunner } from "@/lib/ai/schemas";
import { runJob } from "@/lib/ai/runner";
import { getDefaultRunner } from "@/lib/settings/queries";
import type { Json } from "@/lib/database.types";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

function refresh() {
  revalidatePath("/jobs");
  revalidatePath("/brands/[slug]", "page");
}

export async function enqueueJob(args: { brandId: string; type: JobType; input: unknown; runner?: JobRunner }): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = parseJobInput(args.type, args.input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid job input" };
  const runner = args.runner ?? (await getDefaultRunner());
  const input = parsed.data as Record<string, unknown>;
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({
      brand_id: args.brandId, type: args.type, input: input as Json, runner, created_by: user.id,
      post_id: (input.post_id as string | undefined) ?? null, article_id: (input.article_id as string | undefined) ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not queue job" };
  if (runner === "in_app") after(() => runJob(data.id));
  refresh();
  return { ok: true, id: data.id };
}

export async function retryJob(id: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { data: j } = await supabase.from("generation_jobs").select("id,status,runner,error").eq("id", id).maybeSingle();
  if (!j) return { ok: false, error: "Job not found" };
  if (j.status !== "failed") return { ok: false, error: "Only failed jobs can be retried" };
  const previous = j.error ? { previous_error: j.error } : {};
  const { error } = await supabase.from("generation_jobs").update({ status: "queued", error: null, finished_at: null, started_at: null, result: previous as Json }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (j.runner === "in_app") after(() => runJob(id));
  refresh();
  return { ok: true, id };
}

export async function cancelJob(id: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("generation_jobs")
    .update({ status: "failed", error: "Cancelled", finished_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Only queued jobs can be cancelled" };
  refresh();
  return { ok: true, id };
}
