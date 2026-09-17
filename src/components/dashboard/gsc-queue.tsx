"use client";
import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { markSubmittedToSearchConsole } from "@/lib/articles/actions";

export type GscItem = { id: string; title: string; wp_link: string };

export function GscQueue({ items, websiteUrl }: { items: GscItem[]; websiteUrl: string | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [visible, hide] = useOptimistic(items, (state, id: string) => state.filter((i) => i.id !== id));
  const consoleUrl = websiteUrl ? `https://search.google.com/search-console?resource_id=${encodeURIComponent(websiteUrl)}` : null;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy — select the URL instead");
    }
  };
  const done = (id: string) =>
    start(async () => {
      hide(id);
      const r = await markSubmittedToSearchConsole(id);
      if (r.ok) router.refresh();
      else toast.error(r.error);
    });

  return (
    <section className="space-y-3">
      <Card>
        <CardHeader className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm uppercase tracking-wide">Submit to Search Console ({visible.length})</CardTitle>
            {consoleUrl && (
              <a href={consoleUrl} target="_blank" rel="noreferrer" className="text-sm underline">
                open Search Console →
              </a>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Copy a URL, paste it into the URL inspection bar in Search Console, click <b>Request indexing</b>, then mark it Done here.
          </p>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting — every pushed article has been submitted.</p>
          ) : (
            <ul className="divide-y text-sm">
              {visible.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-1.5">
                  <a href={i.wp_link} target="_blank" rel="noreferrer" className="truncate hover:underline" title={i.title}>
                    {i.wp_link}
                  </a>
                  <span className="flex shrink-0 gap-3 text-xs">
                    <button type="button" className="underline" onClick={() => copy(i.wp_link)}>
                      copy
                    </button>
                    <button type="button" className="underline disabled:opacity-50" disabled={pending} onClick={() => done(i.id)}>
                      done
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
