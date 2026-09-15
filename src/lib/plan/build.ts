import { median, zonedParts } from "./timing";
import type { Candidate, HistoryRow, Lane, Pick, ResolvedSlot } from "./types";

const LANE_ORDER: Lane[] = ["new_page", "recycle", "promo", "filler"];

export function buildWeek(i: {
  slots: ResolvedSlot[];
  dayRanking: number[];
  lanes: Record<Lane, Candidate[]>;
  recycleCap: number;
  skipped: Set<string>;
  existingCandidateIds: Set<string>;
  existingDates: Set<string>;
}): { picks: Pick[]; emptyDays: string[]; summary: Record<Lane | "slots", number> } {
  const byDate = new Map<string, ResolvedSlot[]>();
  for (const s of i.slots) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const dateForDow = (dow: number) => [...byDate.keys()].find((d) => byDate.get(d)![0].dow === dow);
  const days = i.dayRanking.map(dateForDow).filter((d): d is string => Boolean(d) && !i.existingDates.has(d!));

  const used = new Set<string>([...i.skipped, ...i.existingCandidateIds]);
  const queues: Record<Lane, Candidate[]> = { new_page: [...i.lanes.new_page], recycle: [...i.lanes.recycle], promo: [...i.lanes.promo], filler: [...i.lanes.filler] };
  const summary: Record<Lane | "slots", number> = { new_page: 0, recycle: 0, promo: 0, filler: 0, slots: 0 };
  const picks: Pick[] = [];
  const emptyDays: string[] = [];

  const next = (lane: Lane): Candidate | undefined => {
    if (lane === "recycle" && summary.recycle >= i.recycleCap) return undefined;
    while (queues[lane].length) {
      const c = queues[lane].shift()!;
      if (!used.has(c.id)) return c;
    }
    return undefined;
  };

  for (const date of days) {
    let picked: Candidate | undefined;
    for (const lane of LANE_ORDER) {
      picked = next(lane);
      if (picked) break;
    }
    if (!picked) { emptyDays.push(date); continue; }
    used.add(picked.id);
    summary[picked.lane]++;
    summary.slots++;
    picks.push({ date, slots: [...byDate.get(date)!].sort((a, b) => a.at.localeCompare(b.at)), candidate: picked });
  }
  return { picks, emptyDays: emptyDays.sort(), summary };
}

const ratioLabel = (ratio: number | null) => (ratio === null ? "No baseline" : ratio >= 1.5 ? "Well above normal" : ratio >= 0.8 ? "About normal" : "Below normal");

/** History rows on the same calendar day (±1) in previous years, with interactions vs the platform's median. */
export function onThisDay(i: { history: HistoryRow[]; date: string; tz: string; years?: number }): { row: HistoryRow; ratio: number | null; label: string }[] {
  const years = i.years ?? 3;
  const [y, m, d] = i.date.split("-").map(Number);
  const target = Date.UTC(2000, m - 1, d); // year-agnostic day-of-year comparison
  const medians = new Map<string, number>();
  for (const p of ["facebook", "instagram"]) medians.set(p, median(i.history.filter((h) => h.platform === p).map((h) => h.interactions)));
  return i.history
    .map((row) => ({ row, local: zonedParts(row.published_at, i.tz).date }))
    .filter(({ local }) => {
      const [ly, lm, ld] = local.split("-").map(Number);
      if (ly >= y || ly < y - years) return false;
      const diff = Math.abs(Date.UTC(2000, lm - 1, ld) - target) / 86_400_000;
      return diff <= 1 || diff >= 365; // handles Dec 31 / Jan 1 wrap
    })
    .sort((a, b) => Number(b.local.slice(0, 4)) - Number(a.local.slice(0, 4)) || a.local.localeCompare(b.local))
    .map(({ row }) => {
      const med = medians.get(row.platform) ?? 0;
      const ratio = med > 0 ? Math.round((row.interactions / med) * 10) / 10 : null;
      return { row, ratio, label: `${ratioLabel(ratio)} · ${row.interactions}${ratio !== null ? ` · ${ratio.toFixed(1)}x the usual` : ""}` };
    });
}
