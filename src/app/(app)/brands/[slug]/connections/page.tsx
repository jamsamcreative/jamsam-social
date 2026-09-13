import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands/queries";
import { listConnectionsForBrand } from "@/lib/connections/queries";
import { PROVIDER_ORDER } from "@/lib/connections";
import { ConnectionCard } from "@/components/brands/connection-card";
import { ConnectionsToast } from "@/components/brands/connections-toast";
import { Suspense } from "react";
import { BrandNav } from "../brand-nav";

export const metadata = { title: "Connections" };

export default async function ConnectionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const connections = await listConnectionsForBrand(brand.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{brand.name}</h1>
      <BrandNav slug={brand.slug} />
      <Suspense fallback={null}>
        <ConnectionsToast />
      </Suspense>
      <div className="grid gap-4 lg:grid-cols-2">
        {PROVIDER_ORDER.map((p) => (
          <ConnectionCard key={p} brandId={brand.id} slug={brand.slug} provider={p} connection={connections.find((c) => c.provider === p) ?? null} />
        ))}
      </div>
    </div>
  );
}
