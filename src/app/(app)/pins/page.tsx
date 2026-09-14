import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { listPins, type Pin, type PinInsightsJson } from "@/lib/pins/queries";
import { PinStatusBadge } from "@/components/pins/status-badge";
import { Button } from "@/components/ui/button";
import { formatInZone } from "@/lib/time/zoned";

export const metadata = { title: "Pins" };
export const maxDuration = 300;

const FILTERS: { key: string; label: string; statuses?: Pin["status"][] }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts", statuses: ["draft"] },
  { key: "pending", label: "Awaiting approval", statuses: ["pending_approval"] },
  { key: "scheduled", label: "Scheduled", statuses: ["approved", "publishing"] },
  { key: "published", label: "Published", statuses: ["published"] },
  { key: "failed", label: "Failed", statuses: ["failed"] },
  { key: "archived", label: "Archived", statuses: ["archived"] },
];

export default async function PinsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];
  if (!brand) return <p className="text-muted-foreground">Create a brand first. <Link className="underline" href="/brands/new">New brand</Link></p>;
  const filter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const pins = await listPins({ brandId: brand.id, status: filter.statuses });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pins</h1>
          <p className="text-sm text-muted-foreground">{brand.name}. Drafts are approved and scheduled here; JamSam Social publishes them to Pinterest at the scheduled time.</p>
        </div>
        <Button nativeButton={false} render={<Link href="/pins/new" />}>New pin</Button>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link key={f.key} href={f.key === "all" ? "/pins" : `/pins?status=${f.key}`} className={filter.key === f.key ? "font-medium underline" : "text-muted-foreground"}>{f.label}</Link>
        ))}
      </div>
      {pins.length === 0 ? (
        <p className="text-muted-foreground">No pins here yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pins.map((p) => {
            const ins = p.insights as PinInsightsJson;
            return (
              <Link key={p.id} href={`/pins/${p.id}`} className="flex gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.image_url} alt={p.alt_text ?? ""} className="h-24 w-20 shrink-0 rounded object-cover" />
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-medium">{p.title}</p>
                  <PinStatusBadge status={p.status} />
                  <p className="truncate text-xs text-muted-foreground">{p.board_name ?? p.board_id}{p.scheduled_at ? ` · ${formatInZone(p.scheduled_at, brand.timezone)}` : ""}</p>
                  {ins && <p className="text-xs text-muted-foreground">👁 {ins.impressions ?? 0} · 📌 {ins.saves ?? 0} · ↗ {ins.outbound_clicks ?? 0}</p>}
                  {p.error && <p className="truncate text-xs text-destructive">{p.error}</p>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
