import { zonedLocalToUtc } from "@/lib/time/zoned";
import type { BrandSchedule, HistoryRow, ResolvedSlot } from "./types";

export const MIN_SAMPLES = 50;
export const MIN_DAY_SAMPLES = 5;
const MIN_BUCKET_SAMPLES = 3;
const BUCKET_HOURS = 2;

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Brand-local weekday (0 = Sunday), hour and YYYY-MM-DD for an ISO instant. */
export function zonedParts(iso: string, tz: string): { dow: number; hour: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { dow, hour: Number(get("hour")), date: `${get("year")}-${get("month")}-${get("day")}` };
}

/** weekStart (Monday, YYYY-MM-DD) + n days → YYYY-MM-DD, calendar arithmetic only. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Snaps any YYYY-MM-DD to the Monday of its week (calendar arithmetic only, no timezone). Throws on anything that is not a real date. */
export function normaliseWeekStart(ymd: string): string {
  if (!YMD.test(ymd)) throw new Error("weekStart must be a YYYY-MM-DD date");
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.toISOString().slice(0, 10) !== ymd) throw new Error("weekStart must be a YYYY-MM-DD date");
  return addDays(ymd, -((date.getUTCDay() + 6) % 7));
}

/** Date within the week (Mon..Sun) for a weekday number. */
function dateForDow(weekStart: string, dow: number): string {
  return addDays(weekStart, (dow + 6) % 7); // Mon=0 … Sun=6 offsets
}

const pad = (n: number) => String(n).padStart(2, "0");

export function resolveSlots(input: { schedule: BrandSchedule; history: HistoryRow[]; weekStart: string; tz: string }): { slots: ResolvedSlot[]; source: string; dayRanking: number[]; sampleCount: number } {
  const { schedule, history, weekStart, tz } = input;
  const samples = history.filter((h) => h.interactions > 0 || h.reach !== null).map((h) => ({ ...zonedParts(h.published_at, tz), platform: h.platform, value: h.interactions }));
  const refined = samples.length >= MIN_SAMPLES;

  // Per-weekday medians (all platforms) drive day ranking; per platform+weekday+bucket medians move times.
  const byDay = new Map<number, number[]>();
  const byBucket = new Map<string, number[]>();
  for (const s of samples) {
    byDay.set(s.dow, [...(byDay.get(s.dow) ?? []), s.value]);
    const key = `${s.platform}:${s.dow}:${Math.floor(s.hour / BUCKET_HOURS)}`;
    byBucket.set(key, [...(byBucket.get(key) ?? []), s.value]);
  }
  const daySamples = (dow: number) => byDay.get(dow)?.length ?? 0;
  const lowSample = (dow: number) => !refined || daySamples(dow) < MIN_DAY_SAMPLES;

  const slots: ResolvedSlot[] = schedule.slots.map((slot) => {
    const date = dateForDow(weekStart, slot.dow);
    let time = slot.time;
    if (!lowSample(slot.dow)) {
      let best: { bucket: number; med: number } | null = null;
      for (let b = 0; b < 24 / BUCKET_HOURS; b++) {
        const vals = byBucket.get(`${slot.platform}:${slot.dow}:${b}`) ?? [];
        if (vals.length < MIN_BUCKET_SAMPLES) continue;
        const med = median(vals);
        if (!best || med > best.med) best = { bucket: b, med };
      }
      if (best) time = `${pad(best.bucket * BUCKET_HOURS + BUCKET_HOURS / 2)}:00`;
    }
    return { date, dow: slot.dow, platform: slot.platform, at: zonedLocalToUtc(`${date}T${time}`, tz), low_sample: lowSample(slot.dow) };
  });

  const dows = [...new Set(schedule.slots.map((s) => s.dow))];
  const scheduleOrder = (d: number) => (d + 6) % 7;
  const dayRanking = refined
    ? dows.sort((a, b) => {
        const la = lowSample(a), lb = lowSample(b);
        if (la !== lb) return la ? 1 : -1;
        const diff = median(byDay.get(b) ?? []) - median(byDay.get(a) ?? []);
        return diff !== 0 ? diff : scheduleOrder(a) - scheduleOrder(b);
      })
    : dows.sort((a, b) => scheduleOrder(a) - scheduleOrder(b));

  return { slots, source: refined ? `Refined from ${samples.length} measured posts` : "Brand schedule", dayRanking, sampleCount: samples.length };
}
