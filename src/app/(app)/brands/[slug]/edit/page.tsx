import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands/queries";
import { updateBrand } from "@/lib/brands/actions";
import { BrandForm } from "@/components/brands/brand-form";

export default async function EditBrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const action = updateBrand.bind(null, brand.id);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Edit {brand.name}</h1>
      <BrandForm action={action} brand={brand} submitLabel="Save changes" />
    </div>
  );
}
