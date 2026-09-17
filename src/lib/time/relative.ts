const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

export function relativeTime(iso: string, now = new Date()): string {
  const diff = now.getTime() - Date.parse(iso);
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} hr ago`;
  const d = Math.floor(diff / DAY);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function daysUntil(iso: string, now = new Date()): number {
  return Math.floor((Date.parse(iso) - now.getTime()) / DAY);
}
