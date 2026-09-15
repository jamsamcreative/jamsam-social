"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { createSupabasePlanStore } from "./store";
// `useInstead` is aliased so eslint's rules-of-hooks does not mistake it for a React hook.
import { materialiseWeek, rebuildWeek, useInstead as swapForHistoryPost } from "./materialise";
import { importHistoryChunk } from "./history-sync";
import { approvePost } from "@/lib/posts/actions";
import { zonedParts } from "./timing";
import type { PlannedPost } from "./store";
import type { ScheduleSlot } from "./types";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

async function user(): Promise<{ id: string } | null> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { id: user.id } : null;
}
function refresh() {
  revalidatePath("/plan");
  revalidatePath("/posts", "layout");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}
const wrap = async <T,>(fn: () => Promise<T>): Promise<ActionResult<T>> => {
  try { const data = await fn(); refresh(); return { ok: true, data }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
};

/** Skip / use-instead only make sense before anything has gone out; the store functions themselves don't guard. */
const UNPUBLISHED = new Set(["draft", "pending_approval", "approved"]);
const NOT_SKIPPABLE = "Only planned posts that have not published can be skipped";

export async function buildWeekAction(brandId: string, weekStart: string): Promise<ActionResult<{ created: number; emptyDays: string[] }>> {
  const u = await user(); if (!u) return { ok: false, error: "Not signed in" };
  return wrap(() => materialiseWeek(createSupabasePlanStore(), { brandId, weekStart, by: u.id }));
}
export async function rebuildWeekAction(brandId: string, weekStart: string): Promise<ActionResult<{ removed: number; created: number }>> {
  const u = await user(); if (!u) return { ok: false, error: "Not signed in" };
  return wrap(() => rebuildWeek(createSupabasePlanStore(), { brandId, weekStart, by: u.id }));
}
export async function skipPlannedPostAction(postId: string): Promise<ActionResult> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  const store = createSupabasePlanStore();
  const p = await store.getPlannedPost(postId);
  if (!p) return { ok: false, error: "Planned post not found" };
  if (!UNPUBLISHED.has(p.status)) return { ok: false, error: NOT_SKIPPABLE };
  return wrap(async () => {
    await store.discardPlannedPost(postId);
    await store.addSkipped(p.brand_id, p.plan.week_start, p.plan.candidate_id);
    return undefined;
  });
}
export async function useInsteadAction(postId: string, historyId: string): Promise<ActionResult<{ newPostId: string }>> {
  const u = await user(); if (!u) return { ok: false, error: "Not signed in" };
  const store = createSupabasePlanStore();
  const p = await store.getPlannedPost(postId);
  if (!p) return { ok: false, error: "Planned post not found" };
  if (!UNPUBLISHED.has(p.status)) return { ok: false, error: NOT_SKIPPABLE };
  return wrap(() => swapForHistoryPost(store, { postId, historyId, by: u.id }));
}

/** Approves via the posts `approvePost` action (auth + status write live there); only pending_approval posts whose targets all have captions qualify, drafts are counted as waiting. */
async function approveEach(posts: PlannedPost[]): Promise<{ approved: number; waiting: number }> {
  let approved = 0, waiting = 0;
  for (const p of posts) {
    if (p.status === "pending_approval" && p.targets.every((t) => t.caption.trim())) { const r = await approvePost(p.id); if (r.ok) approved++; else waiting++; }
    else if (p.status === "draft") waiting++;
  }
  return { approved, waiting };
}
/** Approves every pending planned post on `date` (brand-local); drafts without captions are reported, not approved. */
export async function approveDayAction(brandId: string, weekStart: string, date: string): Promise<ActionResult<{ approved: number; waiting: number }>> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  return wrap(async () => {
    const store = createSupabasePlanStore();
    const brand = await store.getBrand(brandId);
    if (!brand) throw new Error("Brand not found");
    const posts = (await store.listPlannedPosts(brandId, weekStart)).filter((p) => p.targets.some((t) => t.scheduled_at && zonedParts(t.scheduled_at, brand.timezone).date === date));
    return approveEach(posts);
  });
}
export async function approveWeekAction(brandId: string, weekStart: string): Promise<ActionResult<{ approved: number; waiting: number }>> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  return wrap(async () => approveEach(await createSupabasePlanStore().listPlannedPosts(brandId, weekStart)));
}

const scheduleSchema = z.object({
  recycle_cap: z.coerce.number().int().min(0).max(7),
  rest_days_min: z.coerce.number().int().min(7).max(365),
  rest_days_max: z.coerce.number().int().min(7).max(730),
}).refine((s) => s.rest_days_max >= s.rest_days_min, { message: "Rest window max must be ≥ min" });
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Form fields: fb_0..fb_6 and ig_0..ig_6 as HH:mm or blank; recycle_cap; rest_days_min; rest_days_max. */
export async function saveScheduleAction(brandId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  const parsed = scheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid schedule" };
  const slots: ScheduleSlot[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (const [key, platform] of [["fb", "facebook"], ["ig", "instagram"]] as const) {
      const v = String(formData.get(`${key}_${dow}`) ?? "").trim();
      if (!v) continue;
      if (!TIME.test(v)) return { ok: false, error: `Time for ${platform} on day ${dow} must be HH:mm` };
      slots.push({ dow, platform, time: v });
    }
  }
  return wrap(async () => { await createSupabasePlanStore().saveSchedule(brandId, { slots, ...parsed.data }); return undefined; });
}

export async function importHistoryAction(brandId: string, platform: "facebook" | "instagram"): Promise<ActionResult<{ imported: number; done: boolean }>> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  return wrap(() => importHistoryChunk(createSupabasePlanStore(), { brandId, platform }));
}
