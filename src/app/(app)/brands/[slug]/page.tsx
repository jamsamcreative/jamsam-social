import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands/queries";
import { setBrandActive } from "@/lib/brands/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandNav } from "./brand-nav";

export default async function BrandOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();

  async function toggle() {
    "use server";
    await setBrandActive(brand!.id, !brand!.active);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{brand.name}</h1>
          {!brand.active && <Badge variant="secondary">Archived</Badge>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link href={`/brands/${brand.slug}/edit`} />}>
            Edit
          </Button>
          <form action={toggle}>
            <Button variant={brand.active ? "destructive" : "default"} type="submit">
              {brand.active ? "Archive" : "Restore"}
            </Button>
          </form>
        </div>
      </div>
      <BrandNav slug={brand.slug} />
      <dl className="grid max-w-lg grid-cols-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Slug</dt>
        <dd className="col-span-2 font-mono">{brand.slug}</dd>
        <dt className="text-muted-foreground">Website</dt>
        <dd className="col-span-2">{brand.website_url ?? "Not set"}</dd>
        <dt className="text-muted-foreground">Timezone</dt>
        <dd className="col-span-2">{brand.timezone}</dd>
        <dt className="text-muted-foreground">SEO suffix</dt>
        <dd className="col-span-2">{brand.seo_suffix ?? "Not set"}</dd>
      </dl>
    </div>
  );
}
