import type { Store, StoreJob } from "@/lib/ai/store";

export const QUEUED_STALE_MS = 60_000;
export const RUNNING_STALE_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 3;

/** In-app jobs the after() hook evidently lost (queued too long) or that died mid-run (running too long). */
export function selectStaleJobs(jobs: StoreJob[], now = new Date()): { run: StoreJob[]; giveUp: StoreJob[] } {
  const run: StoreJob[] = [];
  const giveUp: StoreJob[] = [];
  for (const j of jobs) {
    if (j.runner !== "in_app") continue;
    const staleQueued = j.status === "queued" && now.getTime() - Date.parse(j.created_at) > QUEUED_STALE_MS;
    const staleRunning = j.status === "running" && j.started_at !== null && now.getTime() - Date.parse(j.started_at) > RUNNING_STALE_MS;
    if (!staleQueued && !staleRunning) continue;
    (j.attempts >= MAX_ATTEMPTS ? giveUp : run).push(j);
  }
  return { run, giveUp };
}

/** One tick: give up on spent jobs, re-queue stuck ones, then run stale ones sequentially. */
export async function runBackstop(store: Store, run: (id: string) => Promise<void>, now = new Date()): Promise<{ ran: string[]; gaveUp: string[] }> {
  const [queued, running] = await Promise.all([store.listJobs({ status: "queued", runner: "in_app" }), store.listJobs({ status: "running", runner: "in_app" })]);
  const sel = selectStaleJobs([...queued, ...running], now);
  for (const j of sel.giveUp) await store.updateJob(j.id, { status: "failed", error: `Gave up after ${MAX_ATTEMPTS} attempts`, finished_at: now.toISOString() });
  for (const j of sel.run) {
    if (j.status === "running") await store.transitionJob(j.id, ["running"], { status: "queued", started_at: null });
    await run(j.id);
  }
  return { ran: sel.run.map((j) => j.id), gaveUp: sel.giveUp.map((j) => j.id) };
}
