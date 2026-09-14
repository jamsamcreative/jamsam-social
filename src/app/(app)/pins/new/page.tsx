import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { pinFormData } from "@/lib/pins/page-data";
import { PinForm } from "@/components/pins/pin-form";

export const metadata = { title: "New pin" };
export const maxDuration = 300;

export default async function NewPinPage({ searchParams }: { searchParams: Promise<{ project?: string; asset?: string }> }) {
  const sp = await searchParams;
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];
  if (!brand) return <p className="text-muted-foreground">Create a brand first. <Link className="underline" href="/brands/new">New brand</Link></p>;
  const data = await pinFormData(brand.id);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New pin</h1>
        <p className="text-sm text-muted-foreground">For {brand.name}{data.boards.length === 0 ? " — connect Pinterest and sync boards first" : ""}</p>
      </div>
      <PinForm brand={brand} {...data} prefill={{ project_id: sp.project, media_asset_id: sp.asset }} />
    </div>
  );
}
