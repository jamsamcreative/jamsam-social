import { resolveSlots, zonedParts, addDays, normaliseWeekStart } from "./timing";
import { newPageCandidates, recyclePool, promoCandidates, fillerCandidates } from "./candidates";
import { buildWeek } from "./build";
import type { PlanStore, NewPlannedPost, PlannedPost } from "./store";
import type { Candidate, Lane, Pick, PlanMeta, ResolvedSlot, HistoryRow } from "./types";

/** Brand-local Monday (YYYY-MM-DD) of the week containing `date`. */
export function weekStartFor(date: Date, tz: string): string {
  const { dow, date: local } = zonedParts(date.toISOString(), tz);
  return addDays(local, -((dow + 6) % 7));
}

export async function planWeek(store: PlanStore, brandId: string, weekStart: string, now: Date) {
  const [brand, schedule] = await Promise.all([store.getBrand(brandId), store.getSchedule(brandId)]);
  if (!brand) throw new Error("Brand not found");
  if (!schedule || schedule.slots.length === 0) throw new Error("Set a posting schedule on the brand first");
  const [history, projects, articles, usage, favour, planWeekRow, existing] = await Promise.all([
    store.listHistory(brandId), store.listProjects(brandId), store.listPublishedArticles(brandId), store.listUsage(brandId, now), store.favourCategory(brandId), store.getPlanWeek(brandId, weekStart), store.listPlannedPosts(brandId, weekStart),
  ]);
  const timing = resolveSlots({ schedule, history, weekStart, tz: brand.timezone });
  const lanes: Record<Lane, Candidate[]> = {
    new_page: newPageCandidates({ projects, postedProjectIds: usage.postedProjectIds, weekStart }),
    recycle: recyclePool({ history, schedule, recycledHistoryIds: usage.recycledHistoryIds, now }),
    promo: promoCandidates({ articles, promoedArticleIds: usage.promoedArticleIds, now }),
    filler: fillerCandidates({ projects, postedProjectIds: usage.postedProjectIds, pinnedProjectIds: usage.pinnedProjectIds, favourCategory: favour, recentStates: usage.recentStates }),
  };
  const existingDates = new Set(existing.flatMap((p) => p.targets.map((t) => (t.scheduled_at ? zonedParts(t.scheduled_at, brand.timezone).date : ""))).filter(Boolean));
  const built = buildWeek({ slots: timing.slots, dayRanking: timing.dayRanking, lanes, recycleCap: schedule.recycle_cap, skipped: new Set(planWeekRow?.skipped ?? []), existingCandidateIds: new Set(existing.map((p) => p.plan.candidate_id)), existingDates });
  return { ...built, timingSource: timing.source, slots: timing.slots, brand, schedule, recyclePool: lanes.recycle };
}

/** Last line of defence: callers normalise, but a non-Monday key would mis-place slots and double-book a week. */
function assertMonday(weekStart: string): void {
  if (normaliseWeekStart(weekStart) !== weekStart) throw new Error(`weekStart must be a Monday (got ${weekStart})`);
}

const meta = (weekStart: string, c: Candidate): PlanMeta => ({ week_start: weekStart, lane: c.lane, reason: c.reason, candidate_id: c.id, touched: false });

function recyclePostInput(brandId: string, weekStart: string, c: Candidate, slots: ResolvedSlot[], by: string): NewPlannedPost {
  const h = c.history!;
  return {
    brand_id: brandId, title: `Re-run: ${c.title.replace(/^Re-run: /, "")}`, link_url: null, media: h.media.map((m) => ({ url: m.url })), source: "recycled", status: "pending_approval",
    project_id: null, recycled_from: h.post_id, plan: meta(weekStart, c), created_by: by === "cron" ? null : by,
    targets: slots.map((s) => ({ platform: s.platform, caption: h.caption, scheduled_at: s.at })),
  };
}

async function materialisePick(store: PlanStore, brandId: string, weekStart: string, pick: Pick, by: string): Promise<void> {
  const c = pick.candidate;
  if (c.lane === "promo") {
    await store.enqueueJob(brandId, "promo", { article_id: c.article!.id, scheduled_after: pick.slots[0].at, plan: meta(weekStart, c) }, null, c.article!.id);
    return;
  }
  if (c.lane === "recycle") {
    await store.createPlannedPost(recyclePostInput(brandId, weekStart, c, pick.slots, by));
    return;
  }
  const postId = await store.createPlannedPost({
    brand_id: brandId, title: c.title, link_url: c.project?.url ?? null, media: c.media, source: "ai", status: "draft", project_id: c.project?.id ?? null, recycled_from: null,
    plan: meta(weekStart, c), created_by: by === "cron" ? null : by, targets: pick.slots.map((s) => ({ platform: s.platform, caption: "", scheduled_at: s.at })),
  });
  await store.enqueueJob(brandId, "caption", { post_id: postId, plan: { lane: c.lane, reason: c.reason } }, postId, null);
}

export async function materialiseWeek(store: PlanStore, i: { brandId: string; weekStart: string; by: string; now?: Date }): Promise<{ created: number; emptyDays: string[]; summary: Record<Lane | "slots", number> }> {
  assertMonday(i.weekStart);
  const now = i.now ?? new Date();
  const plan = await planWeek(store, i.brandId, i.weekStart, now);
  for (const pick of plan.picks) await materialisePick(store, i.brandId, i.weekStart, pick, i.by);
  const prior = await store.getPlanWeek(i.brandId, i.weekStart);
  await store.upsertPlanWeek({ brand_id: i.brandId, week_start: i.weekStart, built_by: i.by, timing_source: plan.timingSource, skipped: prior?.skipped ?? [], summary: plan.summary });
  return { created: plan.picks.length, emptyDays: plan.emptyDays, summary: plan.summary };
}

const isUntouched = (p: PlannedPost) => !p.plan.touched && (p.status === "draft" || p.status === "pending_approval");

export async function rebuildWeek(store: PlanStore, i: { brandId: string; weekStart: string; by: string; now?: Date }): Promise<{ removed: number; created: number }> {
  assertMonday(i.weekStart);
  const existing = await store.listPlannedPosts(i.brandId, i.weekStart);
  let removed = 0;
  for (const p of existing) if (isUntouched(p)) { await store.discardPlannedPost(p.id); removed++; }
  const out = await materialiseWeek(store, i);
  return { removed, created: out.created };
}

export async function useInstead(store: PlanStore, i: { postId: string; historyId: string; by: string }): Promise<{ newPostId: string }> {
  const post = await store.getPlannedPost(i.postId);
  if (!post) throw new Error("Planned post not found");
  const history = await store.listHistory(post.brand_id);
  const h: HistoryRow | undefined = history.find((x) => x.id === i.historyId);
  if (!h) throw new Error("History post not found");
  const slots: ResolvedSlot[] = post.targets.filter((t) => t.scheduled_at && t.platform !== "gbp").map((t) => ({ date: post.plan.week_start, dow: 0, platform: t.platform as "facebook" | "instagram", at: t.scheduled_at!, low_sample: false }));
  const candidate: Candidate = { id: `history:${h.id}`, lane: "recycle", reason: `Chosen by hand from "on this day" (${h.published_at.slice(0, 10)}, ${h.interactions} interactions).`, title: h.caption.split("\n")[0].slice(0, 80) || "Re-run", media: h.media.map((m) => ({ url: m.url })), history: h };
  await store.discardPlannedPost(post.id);
  await store.addSkipped(post.brand_id, post.plan.week_start, post.plan.candidate_id);
  const newPostId = await store.createPlannedPost(recyclePostInput(post.brand_id, post.plan.week_start, candidate, slots, i.by));
  return { newPostId };
}
