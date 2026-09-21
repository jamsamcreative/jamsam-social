import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { BrandOverview } from "@/lib/dashboard/queries";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" }) {
  return (
    <div>
      <div className={cn("text-2xl font-semibold tabular-nums", value > 0 && tone === "danger" && "text-destructive", value > 0 && tone === "warn" && "text-amber-600")}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function BrandOverviewCard({ brand }: { brand: BrandOverview }) {
  const { needs } = brand;
  return (
    <Link href={`/brands/${brand.slug}`} className="block">
      <Card className="h-full transition-colors hover:bg-muted/40">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{brand.name}</div>
              <div className="truncate text-sm text-muted-foreground">{brand.website_url ?? "No website"}</div>
            </div>
            <span
              className={cn("mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full", brand.failingConnections > 0 ? "bg-destructive" : "bg-green-500")}
              title={brand.failingConnections > 0 ? `${brand.failingConnections} connection${brand.failingConnections === 1 ? "" : "s"} failing` : "All connections healthy"}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Awaiting approval" value={needs.approval.count} tone="warn" />
            <Stat label="Needs attention" value={needs.attention.count} tone="danger" />
            <Stat label="Waiting on Claude" value={needs.claude.count} />
          </div>
          <p className="text-xs text-muted-foreground">
            {needs.total === 0 ? "Nothing needs you" : `${needs.total} to do`} · {needs.scheduled} scheduled
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
