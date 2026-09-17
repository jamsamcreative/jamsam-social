import { Card, CardContent } from "@/components/ui/card";
import { getLinksPageData } from "@/lib/links/queries";
import { ScanCard } from "@/components/links/scan-card";

export const metadata = { title: "Internal links" };
export const maxDuration = 300;

const STAT_TILES = [
  ["pages", "Pages mirrored"],
  ["pending", "Awaiting review"],
  ["added", "Links added"],
] as const;

/** "3 hours ago" / "2 days ago"; `null` reads as never scanned. */
function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default async function LinksPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { brand: brandParam } = await searchParams;
  const data = await getLinksPageData(brandParam ?? null);
  const selectedBrand = brandParam ? data.brands.find((b) => b.slug === brandParam) ?? null : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Internal links</h1>
        <p className="text-sm text-muted-foreground">
          Finds published pages nothing else on the site links to, proposes an exact phrase already written on the site to wrap in a link, and writes it into WordPress on approval. Nothing is
          rewritten and no sentences are invented — orphans with no safe phrase are listed below for a hand edit.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {STAT_TILES.map(([key, label]) => (
          <Card key={key}>
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{data.stats[key]}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Site last scanned {timeAgo(data.lastScan)}.</p>
      <ScanCard
        brands={data.brands}
        selectedSlug={selectedBrand?.slug ?? null}
        scanTarget={selectedBrand?.id ?? "all"}
        suggestions={data.pending}
        none={data.none}
        added={data.added}
      />
    </div>
  );
}
