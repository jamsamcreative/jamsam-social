import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands/queries";
import { listConnectionsForBrand } from "@/lib/connections/queries";
import { PROVIDER_ORDER } from "@/lib/connections";
import { serviceAccount } from "@/lib/google/auth";
import { env } from "@/lib/env";
import { createSupabaseStore } from "@/lib/ai/store";
import { ConnectionCard } from "@/components/brands/connection-card";
import { ConnectionsToast } from "@/components/brands/connections-toast";
import { SeoToolsCards } from "@/components/brands/seo-tools-cards";
import { parseSeoTools } from "@/lib/brands/seo-tools";
import { Suspense } from "react";
import { BrandNav } from "../brand-nav";

export const metadata = { title: "Connections" };

export default async function ConnectionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const [connections, boards] = await Promise.all([listConnectionsForBrand(brand.id), createSupabaseStore().listPinBoards(brand.id)]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">
        {brand.name} <span className="text-muted-foreground">· Settings</span>
      </h1>
      <BrandNav slug={brand.slug} />
      <Suspense fallback={null}>
        <ConnectionsToast />
      </Suspense>
      <div className="grid gap-4 lg:grid-cols-2">
        {[...PROVIDER_ORDER, ...(env.GBP_ENABLED === "true" ? (["gbp"] as const) : [])].map((p) => (
          <ConnectionCard key={p} brandId={brand.id} slug={brand.slug} provider={p} connection={connections.find((c) => c.provider === p) ?? null} serviceAccountEmail={serviceAccount()?.email ?? null} pinterestOauth={Boolean(env.PINTEREST_APP_ID && env.PINTEREST_APP_SECRET)} boards={p === "pinterest" ? boards : []} />
        ))}
        <SeoToolsCards brandId={brand.id} slug={brand.slug} tools={parseSeoTools(brand.seo_tools)} websiteUrl={brand.website_url} />
      </div>
    </div>
  );
}
