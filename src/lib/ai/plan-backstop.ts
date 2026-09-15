import { planMetaSchema } from "./schemas";
import type { Store, StoreJob } from "./store";

/**
 * Deterministic backstop for the Weekly Plan lane: a promo/rewrite job carries `input.plan`, and the writer is
 * asked to copy it into create_post. If it didn't, stamp it onto the created post here so the post still shows
 * up on the plan. Never overwrites a plan the post already has.
 *
 * Best-effort: it runs after the job row is already marked completed, so a failure here must never change a
 * completed job's status. Every error is caught and logged; this function never throws.
 */
export async function carryPlanToPost(store: Store, job: StoreJob, result: Record<string, unknown>): Promise<void> {
  try {
    if (job.type !== "promo" && job.type !== "rewrite") return;
    const postId = (result.post_id as string | undefined) ?? job.post_id;
    const plan = planMetaSchema.safeParse((job.input as { plan?: unknown } | null)?.plan);
    if (!postId || !plan.success) return;
    await store.setPostPlanIfMissing(postId, plan.data);
  } catch (e) {
    console.warn(`[plan-backstop] job ${job.id}: could not stamp plan onto post: ${e instanceof Error ? e.message : String(e)}`);
  }
}
