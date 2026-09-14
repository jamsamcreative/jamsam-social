import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { listConnectionsForBrand } from "@/lib/connections/queries";
import { METRIC_PROVIDERS } from "@/lib/connections";
import { loadRows, loadSyncRuns, earliestDate } from "@/lib/metrics/queries";
import { currentWindow, previousWindow, lastYearWindow, bucketMode, type RangeKey, RANGE_LABELS } from "@/lib/metrics/ranges";
import { buildOverview, buildSearch } from "@/lib/metrics/aggregate";
import { loadContentSocial } from "@/lib/reports/queries";
import { Controls, TABS, type TabKey } from "@/components/reports/controls";
import { SyncBanner } from "@/components/reports/banner";
import { Overview } from "@/components/reports/overview";
import { Search } from "@/components/reports/search";
import { ContentSocial } from "@/components/reports/content-social";

export const metadata = { title: "Reports" };
export const maxDuration = 300;

const OVERVIEW_SOURCES = ["ga4_channel", "ga4_campaign", "ga4_total", "meta_ads_campaign", "meta_ads_total"] as const;
const SEARCH_SOURCES = ["gsc_total", "gsc_query", "gsc_page"] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; range?: string }> }) {
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "overview";
  const range: RangeKey = sp.range && sp.range in RANGE_LABELS ? (sp.range as RangeKey) : "90d";
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];
  if (!brand) {
    return (
      <p className="text-muted-foreground">
        Create a brand first. <Link className="underline" href="/brands/new">New brand</Link>
      </p>
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const [runs, connections, earliest] = await Promise.all([loadSyncRuns(brand.id), listConnectionsForBrand(brand.id), earliestDate(brand.id)]);
  const connected = connections.filter((c) => METRIC_PROVIDERS.includes(c.provider) && c.status !== "not_connected").length;
  const w = currentWindow(range, today, earliest);
  const prevW = previousWindow(w);
  const mode = bucketMode(range);

  let body: React.ReactNode;
  if (tab === "overview") {
    const sources = [...OVERVIEW_SOURCES];
    const [cur, prev, ly, social] = await Promise.all([loadRows(brand.id, sources, w), loadRows(brand.id, sources, prevW), loadRows(brand.id, ["ga4_channel"], lastYearWindow(w)), loadContentSocial(brand.id, w)]);
    body = <Overview vm={buildOverview({ cur, prev, ly, window: w, mode })} social={social} mode={mode} slug={brand.slug} />;
  } else if (tab === "search") {
    const sources = [...SEARCH_SOURCES];
    const [cur, prev] = await Promise.all([loadRows(brand.id, sources, w), loadRows(brand.id, sources, prevW)]);
    body = <Search vm={buildSearch({ cur, prev, window: w, mode })} mode={mode} slug={brand.slug} />;
  } else {
    body = <ContentSocial vm={await loadContentSocial(brand.id, w)} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          {brand.name}. What the marketing spend bought and how the published work performed. Every per-post figure is a median rather than an average, because a handful of boosted posts pull the average far away from what a typical post gets.
        </p>
      </div>
      <SyncBanner brandId={brand.id} slug={brand.slug} runs={runs} connected={connected} />
      <Controls tab={tab} range={range} />
      <p className="text-xs text-muted-foreground">
        {w.start} → {w.end} · compared with {prevW.start} → {prevW.end}
      </p>
      {body}
    </div>
  );
}
