import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { listMediaAssets } from "@/lib/media/queries";
import { UploadForm } from "@/components/media/upload-form";
import { AssetGrid } from "@/components/media/asset-grid";

export const metadata = { title: "Media" };

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const { tag } = await searchParams;
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];

  if (!brand) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Media</h1>
        <p className="text-muted-foreground">
          Create a brand first.{" "}
          <Link className="underline" href="/brands/new">
            New brand
          </Link>
        </p>
      </div>
    );
  }

  const assets = await listMediaAssets(brand.id, { tag });
  const allTags = [...new Set(assets.flatMap((a) => a.tags))].sort();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Media</h1>
        <p className="text-sm text-muted-foreground">{brand.name} library. Switch brands in the header.</p>
      </div>
      <UploadForm brandId={brand.id} />
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/media" className={!tag ? "font-medium underline" : "text-muted-foreground"}>
            All
          </Link>
          {allTags.map((t) => (
            <Link key={t} href={`/media?tag=${encodeURIComponent(t)}`} className={tag === t ? "font-medium underline" : "text-muted-foreground"}>
              {t}
            </Link>
          ))}
        </div>
      )}
      <AssetGrid assets={assets} />
    </div>
  );
}
