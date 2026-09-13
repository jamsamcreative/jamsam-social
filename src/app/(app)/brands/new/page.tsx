import { BrandForm } from "@/components/brands/brand-form";
import { createBrand } from "@/lib/brands/actions";

export const metadata = { title: "New brand" };

export default function NewBrandPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New brand</h1>
      <BrandForm action={createBrand} submitLabel="Create brand" />
    </div>
  );
}
