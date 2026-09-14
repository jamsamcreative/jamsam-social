import { describe, it, expect } from "vitest";
import { selectStaleJobs } from "@/lib/jobs/backstop";
import { job } from "@/lib/ai/fake-store";

const now = new Date("2026-09-13T12:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();

describe("selectStaleJobs", () => {
  it("runs in_app jobs queued > 60s or running > 10min under the attempt cap", () => {
    const jobs = [
      job({ id: "fresh", created_at: ago(10) }),
      job({ id: "stale-queued", created_at: ago(90) }),
      job({ id: "stuck", status: "running", started_at: ago(700), attempts: 1 }),
      job({ id: "running-ok", status: "running", started_at: ago(60), attempts: 1 }),
      job({ id: "mcp", runner: "mcp", created_at: ago(900) }),
      job({ id: "spent", created_at: ago(900), attempts: 3 }),
    ];
    const r = selectStaleJobs(jobs, now);
    expect(r.run.map((j) => j.id)).toEqual(["stale-queued", "stuck"]);
    expect(r.giveUp.map((j) => j.id)).toEqual(["spent"]);
  });
});
