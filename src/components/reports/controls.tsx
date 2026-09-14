import Link from "next/link";
import { RANGE_LABELS, type RangeKey } from "@/lib/metrics/ranges";
import { cn } from "@/lib/utils";

export const TABS = [
  { key: "overview", label: "Overview" },
  { key: "search", label: "Search" },
  { key: "content", label: "Content & social" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];

export function Controls({ tab, range }: { tab: TabKey; range: RangeKey }) {
  const href = (t: TabKey, r: RangeKey) => `/reports?tab=${t}&range=${r}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav className="flex gap-1 rounded-lg border p-1 text-sm">
        {TABS.map((t) => (
          <Link key={t.key} href={href(t.key, range)} className={cn("rounded-md px-3 py-1", tab === t.key ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>
      <nav className="flex gap-1 text-sm">
        {(Object.keys(RANGE_LABELS) as RangeKey[]).map((r) => (
          <Link key={r} href={href(tab, r)} className={cn("rounded-full border px-3 py-1", range === r ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
            {RANGE_LABELS[r]}
          </Link>
        ))}
      </nav>
    </div>
  );
}
