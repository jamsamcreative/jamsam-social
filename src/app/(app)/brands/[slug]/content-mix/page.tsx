import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands/queries";
import { listCategories } from "@/lib/categories/queries";
import { createSupabaseStore } from "@/lib/ai/store";
import { computeContentMix } from "@/lib/ai/content-mix";
import { BrandNav } from "../brand-nav";
import { CategoryEditor } from "@/components/brands/category-editor";

export default async function ContentMixPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const categories = await listCategories(brand.id);
  const mix = computeContentMix(categories, await createSupabaseStore().listRecentCategorizedPosts(brand.id));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">
        {brand.name} <span className="text-muted-foreground">· Settings</span>
      </h1>
      <BrandNav slug={slug} />
      <p className="text-sm text-muted-foreground">
        Target share of each post category. The generator favours whichever category is furthest under target across the last {mix.window} approved/published posts ({mix.total} so far).
      </p>
      <CategoryEditor brandId={brand.id} categories={categories} mix={mix} />
    </div>
  );
}
