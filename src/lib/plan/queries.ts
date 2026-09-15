import { createSupabasePlanStore } from "./store";
import { planWeek } from "./materialise";
import { onThisDay } from "./build";
import { zonedParts, addDays } from "./timing";
import type { PlannedPost, PlanWeek } from "./store";
import type { HistoryRow } from "./types";

export type PlanDay = { date: string; label: string; posts: (PlannedPost & { times: { platform: string; at: string }[] })[]; onThisDay: ReturnType<typeof onThisDay> };
export type PlanPageData = {
  week: PlanWeek | null; days: PlanDay[]; timingSource: string | null; emptyDays: string[]; weeksOnFile: string[];
  recyclePool: { id: string; title: string; interactions: number; published_at: string; platform: string }[];
  counts: { total: number; ready: number; waiting: number; approved: number };
  history: HistoryRow[];
};

/** Everything the /plan page renders for one brand-week. `preview` (a dry run of the planner) is best-effort: no schedule → null, page still renders. */
export async function getPlanPageData(brandId: string, weekStart: string, tz: string): Promise<PlanPageData> {
  const store = createSupabasePlanStore();
  const [week, posts, weeksOnFile, history] = await Promise.all([store.getPlanWeek(brandId, weekStart), store.listPlannedPosts(brandId, weekStart), store.listPlanWeeks(brandId), store.listHistory(brandId)]);
  let preview: Awaited<ReturnType<typeof planWeek>> | null = null;
  try { preview = await planWeek(store, brandId, weekStart, new Date()); } catch { preview = null; }
  const days: PlanDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    const dayPosts = posts.filter((p) => p.targets.some((t) => t.scheduled_at && zonedParts(t.scheduled_at, tz).date === date)).map((p) => ({ ...p, times: p.targets.filter((t) => t.scheduled_at).map((t) => ({ platform: t.platform, at: t.scheduled_at! })) }));
    return { date, label, posts: dayPosts, onThisDay: onThisDay({ history, date, tz }) };
  });
  const counts = { total: posts.length, ready: posts.filter((p) => p.status === "pending_approval").length, waiting: posts.filter((p) => p.status === "draft").length, approved: posts.filter((p) => p.status === "approved").length };
  return {
    week, days, timingSource: week?.timing_source ?? preview?.timingSource ?? null, emptyDays: preview?.emptyDays ?? [], weeksOnFile,
    recyclePool: (preview?.recyclePool ?? []).map((c) => ({ id: c.history!.id, title: c.title, interactions: c.history!.interactions, published_at: c.history!.published_at, platform: c.history!.platform })),
    counts, history,
  };
}
