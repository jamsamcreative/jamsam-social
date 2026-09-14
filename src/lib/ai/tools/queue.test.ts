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
});
