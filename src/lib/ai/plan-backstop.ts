import { planMetaSchema } from "./schemas";
import type { Store, StoreJob } from "./store";

/**
 * Deterministic backstop for the Weekly Plan lane: a promo/rewrite job carries `input.plan`, and the writer is
 * asked to copy it into create_post. If it didn't, stamp it onto the created post here so the post still shows
 * up on the plan. Never overwrites a plan the post already has. Safe to call for every completed job.
 */
export async function carryPlanToPost(store: Store, job: StoreJob, result: Record<string, unknown>): Promise<void> {
  if (job.type !== "promo" && job.type !== "rewrite") return;
  const postId = (result.post_id as string | undefined) ?? job.post_id;
  const plan = planMetaSchema.safeParse((job.input as { plan?: unknown } | null)?.plan);
  if (!postId || !plan.success) return;
  await store.setPostPlanIfMissing(postId, plan.data);
}
