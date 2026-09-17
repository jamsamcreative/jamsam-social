import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ContentMix } from "@/lib/ai/content-mix";

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function ContentQuality({ mix, slug }: { mix: ContentMix; slug: string }) {
  const next = mix.categories.find((c) => c.slug === mix.favour_next);
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Content quality</h2>
        <p className="text-sm text-muted-foreground">
          Mix adherence: the share of the last {mix.window} approved/published posts in each category versus its target. Counted from what actually went out. This drives what Claude is told to
          write next — it is not a measure of writing quality or engagement.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide">
            Category mix · last {mix.total} of {mix.window}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {mix.categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No categories yet —{" "}
              <Link href={`/brands/${slug}/content-mix`} className="underline">
                set targets in Settings → Content mix
              </Link>
              .
            </p>
          ) : (
            <>
              {mix.categories.map((c) => (
                <div key={c.id} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground">
                      {pct(c.actual_share)} of the last {mix.total} · target {pct(c.target_share)}
                    </span>
                  </div>
                  <div className="relative h-2 rounded bg-muted">
                    <div className="h-2 rounded bg-primary" style={{ width: pct(Math.min(c.actual_share, 1)) }} />
                    <div className="absolute top-[-2px] h-3 w-0.5 bg-foreground" style={{ left: pct(Math.min(c.target_share, 1)) }} aria-label={`target ${pct(c.target_share)}`} />
                  </div>
                </div>
              ))}
              {next && (
                <p className="text-sm text-muted-foreground">
                  Target is the tick. Next post: <span className="font-medium text-foreground">{next.name}</span> — furthest under target.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
