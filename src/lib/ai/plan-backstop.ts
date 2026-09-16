import { captionInputSchema, captionResultSchema, planMetaSchema } from "./schemas";
import type { Store, StoreJob } from "./store";

/**
 * Deterministic backstop for the Weekly Plan lane, run after a job row is already marked completed (in-app runner and
 * MCP `complete_job`):
 *
 * - promo/rewrite: the job carries `input.plan` and the writer is asked to copy it into create_post. If it didn't, stamp
 *   it onto the created post here so the post still shows up on the plan. Never overwrites a plan the post already has.
 * - caption: a planner draft (`input.plan` present) has no consumer for the captions stored on the job row, so copy them
 *   onto the draft's targets, set its category and move it to `pending_approval` for the human to review. Claude writing
 *   is not a human edit, so `plan.touched` stays false; the post is never approved here (approval guarantee).
 *
 * Best-effort: a failure here must never change a completed job's status. Every error is caught and logged; this
 * function never throws.
 */
export async function carryPlanToPost(store: Store, job: StoreJob, result: Record<string, unknown>): Promise<void> {
  try {
    if (job.type === "caption") {
      const input = captionInputSchema.safeParse(job.input);
      const parsed = captionResultSchema.safeParse(result);
      if (!input.success || !input.data.plan || !parsed.success) return;
      await store.applyCaptionsToPlannedDraft(input.data.post_id, parsed.data);
      return;
    }
    if (job.type !== "promo" && job.type !== "rewrite") return;
    const postId = (result.post_id as string | undefined) ?? job.post_id;
    const plan = planMetaSchema.safeParse((job.input as { plan?: unknown } | null)?.plan);
    if (!postId || !plan.success) return;
    await store.setPostPlanIfMissing(postId, plan.data);
  } catch (e) {
    console.warn(`[plan-backstop] job ${job.id}: could not carry plan to post: ${e instanceof Error ? e.message : String(e)}`);
  }
}
