import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { listMediaAssets } from "@/lib/media/queries";
import { listCategories } from "@/lib/categories/queries";
import { PostForm } from "@/components/posts/post-form";

export const metadata = { title: "New post" };

export const maxDuration = 300;

export default async function NewPostPage() {
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
  const [assets, categories] = await Promise.all([listMediaAssets(brand.id), listCategories(brand.id)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New post</h1>
        <p className="text-sm text-muted-foreground">For {brand.name}</p>
      </div>
      <PostForm brand={brand} assets={assets} categories={categories} />
    </div>
  );
}
