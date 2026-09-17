import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands/queries";
import { getBrandDashboard } from "@/lib/dashboard/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NeedsYouSection } from "@/components/dashboard/needs-you";
import { HealthChecks } from "@/components/dashboard/health-checks";
import { ContentQuality } from "@/components/dashboard/content-quality";
import { GscQueue } from "@/components/dashboard/gsc-queue";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function BrandDashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const d = await getBrandDashboard(brand);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{brand.name}</h1>
            {!brand.active && <Badge variant="secondary">Archived</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">What needs a person right now, then whether the machinery behind it is healthy.</p>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href={`/brands/${brand.slug}/settings`} />}>
          Settings
        </Button>
      </div>
      <NeedsYouSection needs={d.needs} slug={brand.slug} />
      <HealthChecks health={d.health} />
      <ContentQuality mix={d.mix} slug={brand.slug} />
      <GscQueue items={d.gsc} websiteUrl={brand.website_url} />
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className={cn("inline-block h-2 w-2 rounded-full", d.freshness.stale ? "bg-amber-500" : "bg-green-500")} />
        {d.freshness.note}{" "}
        <Link href="/seo?tab=imports" className="underline">
          Upload a new export
        </Link>
      </p>
    </div>
  );
}
