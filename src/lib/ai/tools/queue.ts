import { z } from "zod";
import { defineTool, ToolError } from "./types";
import type { Json } from "@/lib/database.types";
import { parseJobResult } from "../schemas";
import { carryPlanToPost } from "../plan-backstop";
import { buildBrief } from "../brief";

export const listJobs = defineTool({
  name: "list_jobs",
  description: "Generation jobs queued for an external agent (runner=mcp). Poll this to find work (default status 'queued'), then claim_job.",
  input: z.object({ brand: z.string().optional(), status: z.enum(["queued", "claimed", "running", "completed", "failed"]).default("queued") }),
  run: async (ctx, { brand, status }) => {
    const b = brand ? await ctx.store.getBrandBySlug(brand) : null;
    if (brand && !b) throw new ToolError(`Unknown brand slug "${brand}"`);
    return ctx.store.listJobs({ brandId: b?.id, status, runner: "mcp" });
  },
});

export const claimJob = defineTool({
  name: "claim_job",
  description:
    "Atomically claim a queued job so no other agent takes it. Returns { job, brief } where brief has the brand, guidelines, content mix, the source post/article, media and type-specific instructions. Follow brief.instructions exactly and finish with complete_job.",
  input: z.object({ job_id: z.string().uuid() }),
  run: async (ctx, { job_id }) => {
    const j = await ctx.store.transitionJob(job_id, ["queued"], { status: "claimed", claimed_by: ctx.actor.clientName ?? "mcp", claimed_at: new Date().toISOString() });
    if (!j) {
      const cur = await ctx.store.getJob(job_id);
      throw new ToolError(cur ? `Job ${job_id} already claimed (status ${cur.status})` : `Job ${job_id} not found`);
    }
    return { job: j, brief: await buildBrief(ctx.store, j) };
  },
});

export const completeJob = defineTool({
  name: "complete_job",
  description:
    "Finish a job you claimed. Pass result in the job type's shape — caption: {captions:{facebook,instagram}, category_slug?}; article: {article_id}; promo/rewrite: {post_id} — or error to mark it failed.",
  input: z.object({ job_id: z.string().uuid(), result: z.record(z.string(), z.unknown()).optional(), error: z.string().optional() }),
  run: async (ctx, { job_id, result, error }) => {
    const j = await ctx.store.getJob(job_id);
    if (!j) throw new ToolError(`Job ${job_id} not found`);
    const now = new Date().toISOString();
    if (error) {
      await ctx.store.transitionJob(job_id, ["claimed", "running"], { status: "failed", error, finished_at: now });
      return { ok: true, status: "failed" };
    }
    const parsed = parseJobResult(j.type, result);
    if (!parsed.success) {
      throw new ToolError(`result does not match the ${j.type} result shape: ${parsed.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    }
    const r = parsed.data as Record<string, unknown>;
    const done = await ctx.store.transitionJob(job_id, ["claimed", "running"], {
      status: "completed", result: r as Json, finished_at: now, error: null,
      post_id: (r.post_id as string | undefined) ?? j.post_id, article_id: (r.article_id as string | undefined) ?? j.article_id,
    });
    if (!done) throw new ToolError(`Job ${job_id} is ${j.status}; only claimed/running jobs can be completed`);
    await carryPlanToPost(ctx.store, j, r);
    return { ok: true, status: "completed" };
  },
});

export const QUEUE_TOOLS = [listJobs, claimJob, completeJob];
