export type ImportLike = { kind: string; created_at: string; rows: number };
export const STALE_DAYS = 30;

/** Demand data (CSV/SEMrush) goes stale; GSC-only brands are never stale because that syncs nightly. */
export function dataFreshness(imports: ImportLike[], now = new Date()): { last_refreshed: string | null; days_old: number | null; stale: boolean; note: string } {
  const demand = imports.filter((i) => i.kind === "keywords_csv" || i.kind === "semrush_refresh").sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  if (!demand) return { last_refreshed: null, days_old: null, stale: false, note: "No keyword import yet — opportunities come from Search Console only." };
  const days = Math.floor((now.getTime() - Date.parse(demand.created_at)) / 86_400_000);
  const stale = days > STALE_DAYS;
  return { last_refreshed: demand.created_at, days_old: days, stale, note: `${demand.kind === "semrush_refresh" ? "SEMrush" : "Keyword CSV"} data updated ${days} day${days === 1 ? "" : "s"} ago${stale ? " — treat volumes and competitor positions as a guide, not current" : ""}` };
}
