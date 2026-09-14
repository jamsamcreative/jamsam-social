export type RangeKey = "30d" | "90d" | "12m" | "all";
export type Window = { start: string; end: string }; // YYYY-MM-DD inclusive
export const RANGE_LABELS: Record<RangeKey, string> = { "30d": "Last 30 days", "90d": "Last 90 days", "12m": "Last 12 months", all: "All time" };

const DAY = 86_400_000;
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => iso(new Date(Date.parse(s) + n * DAY));
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** Reporting windows end yesterday (today is always partial). */
export function currentWindow(key: RangeKey, today: string, earliest?: string): Window {
  const end = addDays(today, -1);
  if (key === "30d") return { start: addDays(end, -29), end };
  if (key === "90d") return { start: addDays(end, -89), end };
  if (key === "12m") {
    const d = new Date(end);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return { start: addDays(iso(d), 1), end };
  }
  return { start: earliest && earliest <= end ? earliest : addDays(end, -364), end };
}

export function previousWindow(w: Window): Window {
  const len = daysBetween(w.start, w.end) + 1;
  return { start: addDays(w.start, -len), end: addDays(w.start, -1) };
}

export function lastYearWindow(w: Window): Window {
  const shift = (s: string) => {
    const d = new Date(s);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return iso(d);
  };
  return { start: shift(w.start), end: shift(w.end) };
}

export function bucketMode(key: RangeKey): "week" | "month" {
  return key === "30d" || key === "90d" ? "week" : "month";
}

/** week → ISO date of that week's Monday; month → YYYY-MM. */
export function bucketOf(date: string, mode: "week" | "month"): string {
  if (mode === "month") return date.slice(0, 7);
  const d = new Date(date);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -dow);
}

export function bucketLabel(bucket: string, mode: "week" | "month"): string {
  if (mode === "month") return new Date(bucket + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  return new Date(bucket + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Sync windows: incremental = short lookback; backfill = ~13 months. `lagDays` shifts the end for sources that finalise late (GSC). */
export function syncWindow(opts: { backfill: boolean; today: string; lagDays: number; lookbackDays: number; backfillDays?: number }): Window {
  const end = addDays(opts.today, -Math.max(1, opts.lagDays));
  const days = opts.backfill ? (opts.backfillDays ?? 395) : opts.lookbackDays;
  return { start: addDays(end, -(days - 1)), end };
}

/** Splits a window into consecutive chunks of at most `size` days (API page limits). */
export function chunkWindow(w: Window, size = 31): Window[] {
  const out: Window[] = [];
  let s = w.start;
  while (s <= w.end) {
    const e = addDays(s, size - 1) < w.end ? addDays(s, size - 1) : w.end;
    out.push({ start: s, end: e });
    s = addDays(e, 1);
  }
  return out;
}
