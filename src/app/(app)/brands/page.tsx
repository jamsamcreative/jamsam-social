import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Brands" };

export default async function BrandsPage() {
  const brands = await listBrands({ includeArchived: true });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Brands</h1>
        <Button nativeButton={false} render={<Link href="/brands/new" />}>New brand</Button>
      </div>
      {brands.length === 0 ? (
        <p className="text-muted-foreground">No brands yet. Create your first client.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => (
            <Link key={b.id} href={`/brands/${b.slug}`}>
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardContent className="space-y-1 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{b.name}</span>
                    {!b.active && <Badge variant="secondary">Archived</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{b.website_url ?? "No website"}</p>
                  <p className="text-xs text-muted-foreground">{b.timezone}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
