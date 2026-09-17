import { redirect } from "next/navigation";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";

export default async function DashboardPage() {
  const [brands, current] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === current) ?? brands[0];
  redirect(brand ? `/brands/${brand.slug}` : "/brands/new");
}
