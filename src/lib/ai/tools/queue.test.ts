import { describe, it, expect } from "vitest";
import { fakeStore, job } from "@/lib/ai/fake-store";
import { listJobs, claimJob, completeJob } from "@/lib/ai/tools/queue";

const ctx = (store = fakeStore()) => ({ store, actor: { kind: "mcp" as const, clientName: "claude-code" } });

describe("queue tools", () => {
  it("list_jobs only shows mcp-runner jobs, default queued", async () => {
    const store = fakeStore({ jobs: [job({ id: "a", runner: "mcp" }), job({ id: "b", runner: "in_app" }), job({ id: "c", runner: "mcp", status: "completed" })] });
    const out = (await listJobs.run(ctx(store), { status: "queued" })) as { id: string }[];
    expect(out.map((j) => j.id)).toEqual(["a"]);
  });
  it("claim_job is atomic and returns the brief", async () => {
    const store = fakeStore({ jobs: [job({ runner: "mcp", type: "article", input: { topic: "Deck staining", decision: "new", secondary_keywords: [] } })] });
    const out = (await claimJob.run(ctx(store), { job_id: store.jobs[0].id })) as { job: { status: string }; brief: { brand: { slug: string } } };
    expect(out.job.status).toBe("claimed");
    expect(store.jobs[0]).toMatchObject({ status: "claimed", claimed_by: "claude-code" });
    expect(out.brief.brand.slug).toBe("acme");
    await expect(claimJob.run(ctx(store), { job_id: store.jobs[0].id })).rejects.toThrow(/already claimed/);
  });
  it("complete_job validates the result shape and marks failed on error", async () => {
    const store = fakeStore({ jobs: [job({ runner: "mcp", status: "claimed" })] });
    await expect(completeJob.run(ctx(store), { job_id: store.jobs[0].id, result: { nope: 1 } })).rejects.toThrow(/result/i);
    await completeJob.run(ctx(store), { job_id: store.jobs[0].id, error: "gave up" });
    expect(store.jobs[0]).toMatchObject({ status: "failed", error: "gave up" });
  });
  describe("weekly plan backstop", () => {
    const plan = { week_start: "2026-09-21", lane: "promo" as const, reason: "New article", candidate_id: "article:a1", touched: false };
    const postId = "55555555-5555-4555-8555-555555555555";
    it("stamps job.input.plan onto a promo post that has no plan", async () => {
      const store = fakeStore({ jobs: [job({ runner: "mcp", status: "claimed", type: "promo", input: { article_id: "66666666-6666-4666-8666-666666666666", plan } })] });
      await completeJob.run(ctx(store), { job_id: store.jobs[0].id, result: { post_id: postId } });
      expect(store.jobs[0]).toMatchObject({ status: "completed", post_id: postId });
      expect(store.setPostPlanIfMissing).toHaveBeenCalledWith(postId, plan);
      expect(store.plans.get(postId)).toEqual(plan);
    });
    it("never overwrites a plan the post already has", async () => {
      const store = fakeStore({ jobs: [job({ runner: "mcp", status: "claimed", type: "promo", input: { article_id: "66666666-6666-4666-8666-666666666666", plan } })] });
      const existing = { ...plan, reason: "Set by create_post", touched: true };
      store.plans.set(postId, existing);
      await completeJob.run(ctx(store), { job_id: store.jobs[0].id, result: { post_id: postId } });
      expect(store.plans.get(postId)).toEqual(existing);
    });
    it("does nothing for jobs without a plan", async () => {
      const store = fakeStore({ jobs: [job({ runner: "mcp", status: "claimed", type: "promo", input: { article_id: "66666666-6666-4666-8666-666666666666" } })] });
      await completeJob.run(ctx(store), { job_id: store.jobs[0].id, result: { post_id: postId } });
      expect(store.setPostPlanIfMissing).not.toHaveBeenCalled();
    });
  });
});
