import { describe, it, expect, vi } from "vitest";
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
    it("still completes the job when the backstop write fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const store = fakeStore({ jobs: [job({ runner: "mcp", status: "claimed", type: "promo", input: { article_id: "66666666-6666-4666-8666-666666666666", plan } })] });
      store.setPostPlanIfMissing = vi.fn(async () => { throw new Error("db down"); });
      await expect(completeJob.run(ctx(store), { job_id: store.jobs[0].id, result: { post_id: postId } })).resolves.toEqual({ ok: true, status: "completed" });
      expect(store.jobs[0]).toMatchObject({ status: "completed", post_id: postId, error: null });
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/db down/));
      warn.mockRestore();
    });
    it("complete_job on a planner caption job fills the draft's captions and moves it to pending_approval", async () => {
      const captionPostId = "44444444-4444-4444-8444-444444444444";
      const post = { id: captionPostId, brand_id: "b1", title: "Project", link_url: null, media: [], status: "draft" as const, category_id: null, targets: [{ platform: "facebook" as const, caption: "", scheduled_at: "2026-09-21T22:30:00Z" }, { platform: "instagram" as const, caption: "", scheduled_at: "2026-09-22T00:30:00Z" }] };
      const store = fakeStore({ jobs: [job({ runner: "mcp", status: "claimed", type: "caption", post_id: captionPostId, input: { post_id: captionPostId, plan: { lane: "new_page", reason: "New page" } } })], posts: [post] });
      store.plans.set(captionPostId, { ...plan, lane: "new_page", candidate_id: "project:p1" });
      const captions = { facebook: "Deck done", instagram: "Deck done #decks" };
      await completeJob.run(ctx(store), { job_id: store.jobs[0].id, result: { captions } });
      expect(store.jobs[0]).toMatchObject({ status: "completed", result: { captions } });
      expect(store.posts[0].status).toBe("pending_approval");
      expect(store.posts[0].targets.map((t) => t.caption)).toEqual([captions.facebook, captions.instagram]);
      expect(store.plans.get(captionPostId)?.touched).toBe(false);
    });
    it("does nothing for jobs without a plan", async () => {
      const store = fakeStore({ jobs: [job({ runner: "mcp", status: "claimed", type: "promo", input: { article_id: "66666666-6666-4666-8666-666666666666" } })] });
      await completeJob.run(ctx(store), { job_id: store.jobs[0].id, result: { post_id: postId } });
      expect(store.setPostPlanIfMissing).not.toHaveBeenCalled();
    });
  });
});
