import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Health, HealthCheck } from "@/lib/dashboard/brand-summary";

const ICON: Record<HealthCheck["state"], { glyph: string; className: string }> = {
  ok: { glyph: "✓", className: "text-green-600" },
  pending: { glyph: "◷", className: "text-muted-foreground" },
  warn: { glyph: "⚠", className: "text-amber-600" },
};

export function HealthChecks({ health }: { health: Health }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">System health</h2>
        <p className="text-sm text-muted-foreground">Background jobs nobody watches. All green means you can trust the numbers above.</p>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm uppercase tracking-wide">Checks</CardTitle>
          {health.allGood ? (
            <Badge className="bg-green-600 text-white hover:bg-green-600">All good</Badge>
          ) : (
            <Badge variant="outline" className="border-amber-600 text-amber-700">
              ⚠ Needs a look
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {health.checks.map((c) => {
              const icon = ICON[c.state];
              const row = (
                <>
                  <span className={cn("w-5 shrink-0", icon.className)} aria-label={c.state}>
                    {icon.glyph}
                  </span>
                  <span className="font-medium">{c.label}</span>
                  <span className={cn("text-muted-foreground", c.state === "warn" && "text-amber-700")}>{c.detail}</span>
                </>
              );
              return (
                <li key={c.key} className="py-2">
                  {c.href ? (
                    <Link href={c.href} className="flex items-center gap-2 hover:underline">
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
