import Link from "next/link";
import type { SearchVM } from "@/lib/metrics/aggregate";
import { bucketLabel } from "@/lib/metrics/ranges";
import { fmtInt, fmtPct, fmtPos, fmtDelta } from "@/lib/reports/format";
import { Tiles } from "./tiles";
import { LineChart } from "./charts/line-chart";
import { SearchTables } from "./search-tables";

export function Search({ vm, mode, slug }: { vm: SearchVM; mode: "week" | "month"; slug: string }) {
  if (!vm.hasData) {
    return (
      <p className="rounded-lg border p-4 text-sm text-muted-foreground">
        No Search Console data for this range. Connect Search Console under <Link href={`/brands/${slug}/connections`} className="underline">Connections</Link> and Sync now. Google finalises search data about 3 days late, so the most recent days are always missing.
      </p>
    );
  }
  return (
    <div className="space-y-8">
      <Tiles tiles={vm.tiles} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clicks by period</p>
          <LineChart points={vm.series.map((p) => ({ label: bucketLabel(p.bucket, mode), a: p.clicks }))} seriesA="Clicks" format={(n) => fmtInt(n)} ariaLabel="Search clicks by period" />
        </div>
        <div className="space-y-2 rounded-lg border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Impressions by period</p>
          <LineChart points={vm.series.map((p) => ({ label: bucketLabel(p.bucket, mode), a: p.impressions }))} seriesA="Impressions" format={(n) => fmtInt(n)} ariaLabel="Search impressions by period" color="b" />
        </div>
      </div>
      <SearchTables
        queries={vm.queries.map((q) => ({ key: q.dim, clicks: q.metrics.clicks ?? 0, impressions: q.metrics.impressions ?? 0, ctr: fmtPct(q.metrics.ctr ?? null, 1), position: fmtPos(q.metrics.position ?? null), change: fmtDelta(q.change), up: q.change === null ? null : q.change >= 0 }))}
        pages={vm.pages.map((q) => ({ key: q.dim, clicks: q.metrics.clicks ?? 0, impressions: q.metrics.impressions ?? 0, ctr: fmtPct(q.metrics.ctr ?? null, 1), position: fmtPos(q.metrics.position ?? null), change: fmtDelta(q.change), up: q.change === null ? null : q.change >= 0 }))}
      />
    </div>
  );
}
