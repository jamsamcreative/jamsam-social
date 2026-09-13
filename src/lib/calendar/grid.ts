import { utcToZonedLocal, zonedLocalToUtc } from "@/lib/time/zoned";

const pad = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function monthGrid(year: number, month: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return { date: key(d), inMonth: d.getUTCMonth() === month - 1 };
  });
  return { days, weeks: 6 };
}

export function dayKeyInZone(iso: string, tz: string): string {
  return utcToZonedLocal(iso, tz).slice(0, 10);
}

export function moveKeepingTime(iso: string, newDay: string, tz: string): string {
  const time = utcToZonedLocal(iso, tz).slice(11, 16);
  return zonedLocalToUtc(`${newDay}T${time}`, tz);
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}
