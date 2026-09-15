import { materialiseWeek, weekStartFor } from "./materialise";
import { addDays } from "./timing";
import type { PlanStore } from "./store";

/**
 * Monday cycle: build NEXT week's plan for every active brand with a schedule; idempotent per brand+week. Only ever creates
 * drafts/pending posts (via materialiseWeek); never approves. pg_net discards the response body, so every built or failed
 * brand is also recorded in `sync_runs` (source 'plan') and failures go to console.error.
 */
export async function runPlanCycle(store: PlanStore, now = new Date()): Promise<{ built: string[]; skipped: string[]; failed: { brand: string; error: string }[] }> {
  const out = { built: [] as string[], skipped: [] as string[], failed: [] as { brand: string; error: string }[] };
  const record = async (brandId: string, ok: boolean, error?: string) => {
    try { await store.recordPlanRun(brandId, ok, error); } catch (e) { console.error(`[plan-cron] could not record run for brand ${brandId}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  for (const b of await store.listActiveBrands()) {
    const schedule = await store.getSchedule(b.id);
    if (!schedule || schedule.slots.length === 0) { out.skipped.push(`${b.slug}:no-schedule`); continue; }
    const nextWeek = addDays(weekStartFor(now, b.timezone), 7);
    if (await store.getPlanWeek(b.id, nextWeek)) { out.skipped.push(`${b.slug}:${nextWeek}`); continue; }
    try {
      await materialiseWeek(store, { brandId: b.id, weekStart: nextWeek, by: "cron", now });
      out.built.push(`${b.slug}:${nextWeek}`);
      await record(b.id, true);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      out.failed.push({ brand: b.slug, error });
      console.error(`[plan-cron] ${b.slug}: build of week ${nextWeek} failed: ${error}`);
      await record(b.id, false, error);
    }
  }
  return out;
}
