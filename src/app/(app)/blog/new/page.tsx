import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { listMediaAssets } from "@/lib/media/queries";
import { getWpTerms } from "@/lib/wordpress/terms";
import { ArticleForm } from "@/components/articles/article-form";

export const metadata = { title: "New blog post" };

export default async function NewArticlePage() {
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];
  if (!brand) {
    return (
      <p className="text-muted-foreground">
        Create a brand first.{" "}
        <Link className="underline" href="/brands/new">
          New brand
        </Link>
      </p>
    );
  }
  const [assets, terms] = await Promise.all([listMediaAssets(brand.id), getWpTerms(brand.id).catch(() => null)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New blog post</h1>
        <p className="text-sm text-muted-foreground">For {brand.name}{terms ? "" : " · WordPress not connected, categories and tags unavailable"}</p>
      </div>
      <ArticleForm brand={brand} assets={assets} terms={terms} />
    </div>
  );
}
