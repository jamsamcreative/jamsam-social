// In-memory PlanStore used by Weekly Plan tests. Never imported by app code.
import type { PlanStore, PlannedPost, PlanWeek, NewPlannedPost, BrandLite } from "./store";
import type { ArticleLike, BrandSchedule, HistoryRow, ProjectLike } from "./types";
import type { HistoryInsert } from "@/lib/meta/history";

export const BRAND: BrandLite = { id: "b1", slug: "acme", name: "Acme", timezone: "America/Los_Angeles", active: true };

export type FakePlanStore = PlanStore & {
  posts: (PlannedPost & { media: unknown; source: string; created_by: string | null })[];
  jobs: { id: string; type: string; input: Record<string, unknown>; post_id: string | null; article_id: string | null; status: string }[];
  weeks: PlanWeek[];
  history: HistoryRow[];
  cursor: Record<string, string | null>;
  schedule: BrandSchedule | null;
  runs: { brand_id: string; ok: boolean; error?: string }[];
};

export function fakePlanStore(seed: { schedule?: BrandSchedule | null; history?: HistoryRow[]; projects?: ProjectLike[]; articles?: ArticleLike[]; usage?: Partial<Awaited<ReturnType<PlanStore["listUsage"]>>>; favourCategory?: string | null } = {}): FakePlanStore {
  let n = 0;
  const store: FakePlanStore = {
    posts: [], jobs: [], weeks: [], history: seed.history ?? [], cursor: {}, schedule: seed.schedule ?? null, runs: [],
    async listActiveBrands() { return [BRAND]; },
    async getBrand(id) { return id === BRAND.id ? BRAND : null; },
    async getSchedule() { return store.schedule; },
    async saveSchedule(brandId, patch) { store.schedule = { brand_id: brandId, slots: [], recycle_cap: 3, rest_days_min: 60, rest_days_max: 90, history_synced_at: null, ...store.schedule, ...patch }; },
    async listHistory() { return store.history; },
    async upsertHistory(brandId, rows: HistoryInsert[], postId = null) {
      for (const r of rows) {
        const idx = store.history.findIndex((h) => h.platform === r.platform && h.external_id === r.external_id);
        const row: HistoryRow = { id: idx >= 0 ? store.history[idx].id : `h${++n}`, brand_id: brandId, ...r, interactions: r.likes + r.comments + r.shares, post_id: postId ?? (idx >= 0 ? store.history[idx].post_id : null) };
        if (idx >= 0) store.history[idx] = row; else store.history.push(row);
      }
      return rows.length;
    },
    async getHistoryCursor() { return store.cursor; },
    async setHistoryCursor(brandId, cursor, synced) {
      store.cursor = cursor;
      if (!synced) return;
      if (store.schedule) store.schedule.history_synced_at = new Date().toISOString();
      else store.schedule = { brand_id: brandId, slots: [], recycle_cap: 3, rest_days_min: 60, rest_days_max: 90, history_synced_at: new Date().toISOString() };
    },
    async listProjects() { return seed.projects ?? []; },
    async listPublishedArticles() { return seed.articles ?? []; },
    async listUsage() { return { postedProjectIds: new Set(), pinnedProjectIds: new Set(), recycledHistoryIds: new Set(), promoedArticleIds: new Set(), recentStates: [], ...seed.usage }; },
    async favourCategory() { return seed.favourCategory ?? null; },
    async listPlannedPosts(_b, weekStart) { return store.posts.filter((p) => p.status !== "archived" && p.plan.week_start === weekStart); },
    async getPlannedPost(id) { return store.posts.find((p) => p.id === id) ?? null; },
    async createPlannedPost(input: NewPlannedPost) {
      const id = `p${++n}`;
      store.posts.push({ id, brand_id: input.brand_id, title: input.title, status: input.status, project_id: input.project_id, recycled_from: input.recycled_from, plan: input.plan, media: input.media, source: input.source, created_by: input.created_by, targets: input.targets.map((t) => ({ ...t, status: "pending" })) });
      return id;
    },
    async discardPlannedPost(id) {
      const p = store.posts.find((x) => x.id === id);
      if (p) p.status = "archived";
      for (const j of store.jobs) if (j.post_id === id && (j.status === "queued" || j.status === "claimed")) j.status = "failed";
    },
    async markTouched(id) { const p = store.posts.find((x) => x.id === id); if (p) p.plan = { ...p.plan, touched: true }; },
    async enqueueJob(_b, type, input, post_id, article_id) { const id = `j${++n}`; store.jobs.push({ id, type, input, post_id, article_id, status: "queued" }); return id; },
    async getPlanWeek(_b, weekStart) { return store.weeks.find((w) => w.week_start === weekStart) ?? null; },
    async upsertPlanWeek(week) {
      const idx = store.weeks.findIndex((w) => w.week_start === week.week_start);
      const row = { ...week, built_at: new Date().toISOString() };
      if (idx >= 0) store.weeks[idx] = row; else store.weeks.push(row);
    },
    async addSkipped(_b, weekStart, id) { const w = store.weeks.find((x) => x.week_start === weekStart); if (w && !w.skipped.includes(id)) w.skipped.push(id); },
    async listPlanWeeks() { return store.weeks.map((w) => w.week_start).sort().reverse(); },
    async recordPlanRun(brand_id, ok, error) { store.runs.push({ brand_id, ok, error }); },
  };
  return store;
}
