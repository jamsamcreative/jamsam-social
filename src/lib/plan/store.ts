import { createAdminSupabase } from "@/lib/supabase/admin";
import { getDefaultRunner } from "@/lib/settings/queries";
import { computeContentMix } from "@/lib/ai/content-mix";
import type { Json } from "@/lib/database.types";
import type { HistoryInsert } from "@/lib/meta/history";
import type { ArticleLike, BrandSchedule, HistoryRow, Lane, PlanMeta, ProjectLike, ScheduleSlot } from "./types";

export type PlannedPost = {
  id: string; brand_id: string; title: string; status: string; project_id: string | null; recycled_from: string | null; plan: PlanMeta;
  targets: { platform: "facebook" | "instagram" | "gbp"; caption: string; scheduled_at: string | null; status: string }[];
};
export type PlanWeek = { brand_id: string; week_start: string; built_at: string; built_by: string; timing_source: string; skipped: string[]; summary: Record<Lane | "slots", number> };
export type BrandLite = { id: string; slug: string; name: string; timezone: string; active: boolean };

export type NewPlannedPost = {
  brand_id: string; title: string; link_url: string | null; media: { url: string; alt?: string }[]; source: "ai" | "recycled";
  status: "draft" | "pending_approval"; project_id: string | null; recycled_from: string | null; plan: PlanMeta; created_by: string | null;
  targets: { platform: "facebook" | "instagram"; caption: string; scheduled_at: string }[];
};

export interface PlanStore {
  listActiveBrands(): Promise<BrandLite[]>;
  getBrand(brandId: string): Promise<BrandLite | null>;
  getSchedule(brandId: string): Promise<BrandSchedule | null>;
  saveSchedule(brandId: string, patch: { slots?: ScheduleSlot[]; recycle_cap?: number; rest_days_min?: number; rest_days_max?: number }): Promise<void>;
  listHistory(brandId: string): Promise<HistoryRow[]>;
  upsertHistory(brandId: string, rows: HistoryInsert[], postId?: string | null): Promise<number>;
  getHistoryCursor(brandId: string): Promise<Record<string, string | null>>;
  setHistoryCursor(brandId: string, cursor: Record<string, string | null>, synced: boolean): Promise<void>;
  listProjects(brandId: string): Promise<ProjectLike[]>;
  listPublishedArticles(brandId: string): Promise<ArticleLike[]>;
  /** project ids referenced by any non-archived post; history ids / recycled_from used by posts in the last 180 days; article ids with a promo post; states used in the last 4 weeks. */
  listUsage(brandId: string, now: Date): Promise<{ postedProjectIds: Set<string>; pinnedProjectIds: Set<string>; recycledHistoryIds: Set<string>; promoedArticleIds: Set<string>; recentStates: string[] }>;
  favourCategory(brandId: string): Promise<string | null>;
  listPlannedPosts(brandId: string, weekStart: string): Promise<PlannedPost[]>;
  getPlannedPost(postId: string): Promise<PlannedPost | null>;
  createPlannedPost(input: NewPlannedPost): Promise<string>;
  /** Archives the post and cancels its queued jobs. */
  discardPlannedPost(postId: string): Promise<void>;
  markTouched(postId: string): Promise<void>;
  enqueueJob(brandId: string, type: "caption" | "promo", input: Record<string, unknown>, postId: string | null, articleId: string | null): Promise<string>;
  getPlanWeek(brandId: string, weekStart: string): Promise<PlanWeek | null>;
  upsertPlanWeek(week: Omit<PlanWeek, "built_at">): Promise<void>;
  addSkipped(brandId: string, weekStart: string, candidateId: string): Promise<void>;
  listPlanWeeks(brandId: string): Promise<string[]>;
}

const fail = (e: { message: string }): never => { throw new Error(e.message); };

export function createSupabasePlanStore(): PlanStore {
  const admin = createAdminSupabase();
  const mapPost = (p: Record<string, unknown>): PlannedPost => ({
    id: p.id as string, brand_id: p.brand_id as string, title: p.title as string, status: p.status as string, project_id: (p.project_id as string | null) ?? null, recycled_from: (p.recycled_from as string | null) ?? null,
    plan: p.plan as PlanMeta, targets: ((p.targets as PlannedPost["targets"]) ?? []).map((t) => ({ platform: t.platform, caption: t.caption, scheduled_at: t.scheduled_at, status: t.status })),
  });
  return {
    async listActiveBrands() {
      const { data, error } = await admin.from("brands").select("id,slug,name,timezone,active").eq("active", true);
      if (error) fail(error);
      return data ?? [];
    },
    async getBrand(brandId) {
      const { data } = await admin.from("brands").select("id,slug,name,timezone,active").eq("id", brandId).maybeSingle();
      return data ?? null;
    },
    async getSchedule(brandId) {
      const { data } = await admin.from("brand_schedules").select("*").eq("brand_id", brandId).maybeSingle();
      if (!data) return null;
      return { brand_id: data.brand_id, slots: (data.slots as unknown as ScheduleSlot[]) ?? [], recycle_cap: data.recycle_cap, rest_days_min: data.rest_days_min, rest_days_max: data.rest_days_max, history_synced_at: data.history_synced_at };
    },
    async saveSchedule(brandId, patch) {
      const { error } = await admin.from("brand_schedules").upsert({ brand_id: brandId, ...(patch.slots ? { slots: patch.slots as unknown as Json } : {}), ...(patch.recycle_cap !== undefined ? { recycle_cap: patch.recycle_cap } : {}), ...(patch.rest_days_min !== undefined ? { rest_days_min: patch.rest_days_min } : {}), ...(patch.rest_days_max !== undefined ? { rest_days_max: patch.rest_days_max } : {}), updated_at: new Date().toISOString() }, { onConflict: "brand_id" });
      if (error) fail(error);
    },
    async listHistory(brandId) {
      const { data, error } = await admin.from("social_history").select("*").eq("brand_id", brandId).order("published_at", { ascending: false }).limit(5000);
      if (error) fail(error);
      return (data ?? []).map((h) => ({ ...h, platform: h.platform as "facebook" | "instagram", media: (h.media as unknown as HistoryRow["media"]) ?? [] }));
    },
    async upsertHistory(brandId, rows, postId = null) {
      if (rows.length === 0) return 0;
      const { error } = await admin.from("social_history").upsert(rows.map((r) => ({ brand_id: brandId, ...r, media: r.media as unknown as Json, post_id: postId, fetched_at: new Date().toISOString() })), { onConflict: "brand_id,platform,external_id" });
      if (error) fail(error);
      return rows.length;
    },
    async getHistoryCursor(brandId) {
      const { data } = await admin.from("brand_schedules").select("history_cursor").eq("brand_id", brandId).maybeSingle();
      return ((data?.history_cursor as unknown as Record<string, string | null>) ?? {});
    },
    async setHistoryCursor(brandId, cursor, synced) {
      const { error } = await admin.from("brand_schedules").upsert({ brand_id: brandId, history_cursor: cursor as unknown as Json, ...(synced ? { history_synced_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() }, { onConflict: "brand_id" });
      if (error) fail(error);
    },
    async listProjects(brandId) {
      const { data, error } = await admin.from("projects").select("id,title,url,category,state,images,imported_at").eq("brand_id", brandId);
      if (error) fail(error);
      return (data ?? []).map((p) => ({ ...p, images: (p.images as unknown as ProjectLike["images"]) ?? [] }));
    },
    async listPublishedArticles(brandId) {
      const { data, error } = await admin.from("articles").select("id,title,published_at").eq("brand_id", brandId).eq("status", "published");
      if (error) fail(error);
      return (data ?? []) as ArticleLike[];
    },
    async listUsage(brandId, now) {
      const since180 = new Date(now.getTime() - 180 * 86_400_000).toISOString();
      const since90 = new Date(now.getTime() - 90 * 86_400_000).toISOString();
      const since28 = new Date(now.getTime() - 28 * 86_400_000).toISOString();
      const [{ data: posts }, { data: pins }, { data: recentPosts }] = await Promise.all([
        admin.from("posts").select("project_id,recycled_from,plan,created_at").eq("brand_id", brandId).neq("status", "archived"),
        admin.from("pins").select("project_id").eq("brand_id", brandId).neq("status", "archived").gte("created_at", since90),
        admin.from("posts").select("project:projects(state)").eq("brand_id", brandId).neq("status", "archived").gte("created_at", since28).not("project_id", "is", null),
      ]);
      const postedProjectIds = new Set<string>(), recycledHistoryIds = new Set<string>(), promoedArticleIds = new Set<string>();
      for (const p of posts ?? []) {
        if (p.project_id) postedProjectIds.add(p.project_id);
        const plan = p.plan as unknown as PlanMeta | null;
        if (plan?.lane === "recycle" && p.created_at >= since180) recycledHistoryIds.add(plan.candidate_id.replace(/^history:/, ""));
        if (plan?.lane === "promo") promoedArticleIds.add(plan.candidate_id.replace(/^article:/, ""));
      }
      const pinnedProjectIds = new Set((pins ?? []).map((p) => p.project_id).filter((x): x is string => Boolean(x)));
      const recentStates = [...new Set((recentPosts ?? []).map((r) => (r.project as unknown as { state: string | null } | null)?.state).filter((s): s is string => Boolean(s)))];
      return { postedProjectIds, pinnedProjectIds, recycledHistoryIds, promoedArticleIds, recentStates };
    },
    async favourCategory(brandId) {
      const [{ data: cats }, { data: recent }] = await Promise.all([
        admin.from("post_categories").select("id,name,slug,target_share,description,sort_order").eq("brand_id", brandId).order("sort_order"),
        admin.from("posts").select("category_id").eq("brand_id", brandId).in("status", ["approved", "published"]).order("created_at", { ascending: false }).limit(20),
      ]);
      if (!cats?.length) return null;
      const mix = computeContentMix(cats.map((c) => ({ ...c, target_share: Number(c.target_share) })), recent ?? []);
      return cats.find((c) => c.slug === mix.favour_next)?.name ?? null;
    },
    async listPlannedPosts(brandId, weekStart) {
      const { data, error } = await admin.from("posts").select("id,brand_id,title,status,project_id,recycled_from,plan,targets:post_targets(platform,caption,scheduled_at,status)").eq("brand_id", brandId).neq("status", "archived").contains("plan", { week_start: weekStart });
      if (error) fail(error);
      return (data ?? []).map((p) => mapPost(p as unknown as Record<string, unknown>));
    },
    async getPlannedPost(postId) {
      const { data } = await admin.from("posts").select("id,brand_id,title,status,project_id,recycled_from,plan,targets:post_targets(platform,caption,scheduled_at,status)").eq("id", postId).not("plan", "is", null).maybeSingle();
      return data ? mapPost(data as unknown as Record<string, unknown>) : null;
    },
    async createPlannedPost(input) {
      const { data, error } = await admin.from("posts").insert({
        brand_id: input.brand_id, title: input.title, link_url: input.link_url, media: input.media as unknown as Json, source: input.source, status: input.status,
        project_id: input.project_id, recycled_from: input.recycled_from, plan: input.plan as unknown as Json, created_by: input.created_by,
      }).select("id").single();
      if (error || !data) fail(error ?? { message: "insert failed" });
      const { error: te } = await admin.from("post_targets").insert(input.targets.map((t) => ({ post_id: data!.id, platform: t.platform, caption: t.caption, scheduled_at: t.scheduled_at })));
      if (te) fail(te);
      return data!.id;
    },
    async discardPlannedPost(postId) {
      await admin.from("generation_jobs").update({ status: "failed", error: "Cancelled: plan rebuilt" }).eq("post_id", postId).in("status", ["queued", "claimed"]);
      const { error } = await admin.from("posts").update({ status: "archived" }).eq("id", postId);
      if (error) fail(error);
    },
    async markTouched(postId) {
      const { data } = await admin.from("posts").select("plan").eq("id", postId).maybeSingle();
      const plan = data?.plan as unknown as PlanMeta | null;
      if (!plan || plan.touched) return;
      await admin.from("posts").update({ plan: { ...plan, touched: true } as unknown as Json }).eq("id", postId);
    },
    async enqueueJob(brandId, type, input, postId, articleId) {
      const runner = await getDefaultRunner();
      const { data, error } = await admin.from("generation_jobs").insert({ brand_id: brandId, type, input: input as Json, runner, post_id: postId, article_id: articleId }).select("id").single();
      if (error || !data) fail(error ?? { message: "job insert failed" });
      return data!.id;
    },
    async getPlanWeek(brandId, weekStart) {
      const { data } = await admin.from("plan_weeks").select("*").eq("brand_id", brandId).eq("week_start", weekStart).maybeSingle();
      return data ? { ...data, skipped: (data.skipped as unknown as string[]) ?? [], summary: data.summary as unknown as PlanWeek["summary"] } : null;
    },
    async upsertPlanWeek(week) {
      const { error } = await admin.from("plan_weeks").upsert({ ...week, skipped: week.skipped as unknown as Json, summary: week.summary as unknown as Json, built_at: new Date().toISOString() }, { onConflict: "brand_id,week_start" });
      if (error) fail(error);
    },
    async addSkipped(brandId, weekStart, candidateId) {
      const cur = await this.getPlanWeek(brandId, weekStart);
      if (!cur) return;
      await admin.from("plan_weeks").update({ skipped: [...new Set([...cur.skipped, candidateId])] as unknown as Json }).eq("brand_id", brandId).eq("week_start", weekStart);
    },
    async listPlanWeeks(brandId) {
      const { data } = await admin.from("plan_weeks").select("week_start").eq("brand_id", brandId).order("week_start", { ascending: false });
      return (data ?? []).map((w) => w.week_start);
    },
  };
}
