import Link from "next/link";
import { listBrandOverviews } from "@/lib/dashboard/queries";
import { Button } from "@/components/ui/button";
import { BrandOverviewCard } from "@/components/dashboard/brand-overview-card";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const brands = await listBrandOverviews();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Every active brand, the ones needing you first. Open a brand for the full picture.</p>
        </div>
        <Button nativeButton={false} render={<Link href="/brands/new" />}>New brand</Button>
      </div>
      {brands.length === 0 ? (
        <p className="text-muted-foreground">No brands yet. Create your first client to get started.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {brands.map((b) => (
            <BrandOverviewCard key={b.id} brand={b} />
          ))}
        </div>
      )}
    </div>
  );
}
