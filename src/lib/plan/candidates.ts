import type { ArticleLike, BrandSchedule, Candidate, HistoryRow, ProjectLike } from "./types";

export const NEW_PAGE_WINDOW_DAYS = 30;
export const PROMO_WINDOW_DAYS = 14;

export const daysBetween = (a: Date, b: Date) => Math.floor(Math.abs(a.getTime() - b.getTime()) / 86_400_000);

const projectMedia = (p: ProjectLike) => p.images.slice(0, 4).map((i) => ({ url: i.url, alt: i.alt }));

export function newPageCandidates(i: { projects: ProjectLike[]; postedProjectIds: Set<string>; weekStart: string }): Candidate[] {
  const cutoff = new Date(`${i.weekStart}T00:00:00Z`).getTime() - NEW_PAGE_WINDOW_DAYS * 86_400_000;
  return i.projects
    .filter((p) => !i.postedProjectIds.has(p.id) && Date.parse(p.imported_at) >= cutoff)
    .sort((a, b) => Date.parse(a.imported_at) - Date.parse(b.imported_at))
    .map((p) => ({ id: `project:${p.id}`, lane: "new_page", reason: `New project page (added ${p.imported_at.slice(0, 10)}) that has never been posted.`, title: p.title, media: projectMedia(p), project: p }));
}

function percentile(vals: number[], p: number): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

/** Rested (≥ rest_days_min ago), top-quartile-for-its-platform history rows not already recycled, best first. Uncapped. */
export function recyclePool(i: { history: HistoryRow[]; schedule: BrandSchedule; recycledHistoryIds: Set<string>; now: Date }): Candidate[] {
  const p75 = new Map<string, number>();
  for (const platform of ["facebook", "instagram"] as const) p75.set(platform, percentile(i.history.filter((h) => h.platform === platform).map((h) => h.interactions), 0.75));
  return i.history
    .filter((h) => {
      const age = daysBetween(i.now, new Date(h.published_at));
      return age >= i.schedule.rest_days_min && !i.recycledHistoryIds.has(h.id) && h.interactions > 0 && h.interactions >= (p75.get(h.platform) ?? 0);
    })
    .sort((a, b) => b.interactions - a.interactions || Date.parse(a.published_at) - Date.parse(b.published_at))
    .map((h) => {
      const age = daysBetween(i.now, new Date(h.published_at));
      const inWindow = age <= i.schedule.rest_days_max;
      return {
        id: `history:${h.id}`, lane: "recycle" as const, title: h.caption.split("\n")[0].slice(0, 80) || "Re-run", media: h.media.map((m) => ({ url: m.url })), history: h,
        reason: `Ran ${age} days ago with ${h.interactions} interactions (top 25% for this brand on ${h.platform})${inWindow ? ", inside the preferred rest window" : ""}.`,
      };
    });
}

export function promoCandidates(i: { articles: ArticleLike[]; promoedArticleIds: Set<string>; now: Date }): Candidate[] {
  return i.articles
    .filter((a) => a.published_at && !i.promoedArticleIds.has(a.id) && daysBetween(i.now, new Date(a.published_at)) <= PROMO_WINDOW_DAYS)
    .sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!))
    .map((a) => ({ id: `article:${a.id}`, lane: "promo" as const, reason: `Article published ${a.published_at!.slice(0, 10)} with no promo post yet.`, title: a.title, media: [], article: a }));
}

/** Never-posted projects, favouring the under-served category, then states not seen lately, then newest. */
export function fillerCandidates(i: { projects: ProjectLike[]; postedProjectIds: Set<string>; pinnedProjectIds: Set<string>; favourCategory: string | null; recentStates: string[] }): Candidate[] {
  const recent = new Set(i.recentStates);
  const score = (p: ProjectLike) => (p.category && p.category === i.favourCategory ? 2 : 0) + (p.state && !recent.has(p.state) ? 1 : 0);
  return i.projects
    .filter((p) => !i.postedProjectIds.has(p.id) && !i.pinnedProjectIds.has(p.id))
    .sort((a, b) => score(b) - score(a) || Date.parse(b.imported_at) - Date.parse(a.imported_at) || a.id.localeCompare(b.id))
    .map((p) => ({
      id: `project:${p.id}`, lane: "filler" as const, title: p.title, media: projectMedia(p), project: p,
      reason: `Never posted. Picked to balance the week${p.category === i.favourCategory && p.category ? ` (${p.category} is under target)` : ""}${p.state && !recent.has(p.state) ? ` and to show ${p.state}` : ""}.`,
    }));
}
