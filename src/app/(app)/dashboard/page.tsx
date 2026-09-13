import Link from "next/link";
import { getDashboardBrands } from "@/lib/dashboard/queries";
import { PROVIDER_ORDER, PROVIDER_LABELS } from "@/lib/connections";
import { StatusBadge } from "@/components/brands/connection-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatInZone } from "@/lib/time/zoned";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const brands = await getDashboardBrands();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Button nativeButton={false} render={<Link href="/brands/new" />}>New brand</Button>
      </div>
      {brands.length === 0 ? (
        <p className="text-muted-foreground">No active brands. Create your first client to get started.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {brands.map((b) => (
            <Card key={b.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  <Link href={`/brands/${b.slug}`} className="hover:underline">
                    {b.name}
                  </Link>
                </CardTitle>
                <p className="text-sm text-muted-foreground">{b.website_url ?? "No website"}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                <ul className="space-y-1 text-sm">
                  {PROVIDER_ORDER.map((p) => (
                    <li key={p} className="flex items-center justify-between">
                      <span>{PROVIDER_LABELS[p]}</span>
                      <StatusBadge status={b.connections[p]} />
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {b.pending_approval_count > 0 ? (
                    <Link href="/posts?status=pending" className="font-medium text-amber-700 underline">
                      {b.pending_approval_count} awaiting approval
                    </Link>
                  ) : (
                    "Nothing awaiting approval"
                  )}
                  {" · "}
                  {b.next_scheduled ? `next: ${formatInZone(b.next_scheduled.at, b.timezone)} ${b.next_scheduled.title}` : "nothing scheduled"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {b.article_draft_count} article draft{b.article_draft_count === 1 ? "" : "s"} · {b.media_count} image{b.media_count === 1 ? "" : "s"} in library ·{" "}
                  <Link href={`/brands/${b.slug}/connections`} className="underline">
                    Connections
                  </Link>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
