import { materialiseWeek, weekStartFor } from "./materialise";
import { addDays } from "./timing";
import type { PlanStore } from "./store";

/** Monday cycle: build NEXT week's plan for every active brand with a schedule; idempotent per brand+week. Only ever creates drafts/pending posts (via materialiseWeek); never approves. */
export async function runPlanCycle(store: PlanStore, now = new Date()): Promise<{ built: string[]; skipped: string[]; failed: { brand: string; error: string }[] }> {
  const out = { built: [] as string[], skipped: [] as string[], failed: [] as { brand: string; error: string }[] };
  for (const b of await store.listActiveBrands()) {
    const schedule = await store.getSchedule(b.id);
    if (!schedule || schedule.slots.length === 0) { out.skipped.push(`${b.slug}:no-schedule`); continue; }
    const nextWeek = addDays(weekStartFor(now, b.timezone), 7);
    if (await store.getPlanWeek(b.id, nextWeek)) { out.skipped.push(`${b.slug}:${nextWeek}`); continue; }
    try {
      await materialiseWeek(store, { brandId: b.id, weekStart: nextWeek, by: "cron", now });
      out.built.push(`${b.slug}:${nextWeek}`);
    } catch (e) {
      out.failed.push({ brand: b.slug, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
