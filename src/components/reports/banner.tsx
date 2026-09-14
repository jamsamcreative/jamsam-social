"use client";
import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncNow } from "@/lib/metrics/actions";
import { fmtDate } from "@/lib/reports/format";
import type { SyncRun } from "@/lib/metrics/queries";

const LABEL: Record<string, string> = { ga4: "Google Analytics", gsc: "Search Console", meta_ads: "Meta Ads" };

export function SyncBanner({ brandId, slug, runs, connected }: { brandId: string; slug: string; runs: SyncRun[]; connected: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const lastOk = runs.map((r) => r.last_ok_at).filter((x): x is string => Boolean(x)).sort().at(-1);
  const errors = runs.filter((r) => r.last_error);
  const sync = () =>
    start(async () => {
      const r = await syncNow(brandId);
      if (r.ok) {
        const failed = Object.entries(r.result).filter(([, v]) => !v.ok);
        if (failed.length) toast.warning(`Synced with errors: ${failed.map(([k]) => LABEL[k]).join(", ")}`);
        else toast.success("Synced");
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {connected === 0 ? "No marketing connections yet." : lastOk ? `Marketing data synced ${fmtDate(lastOk)}.` : "Not synced yet."}{" "}
          <Link href={`/brands/${slug}/connections`} className="underline">
            Connections
          </Link>
        </span>
        {connected > 0 && (
          <Button size="sm" variant="outline" disabled={pending} onClick={sync}>
            {pending ? "Syncing… (first sync backfills 13 months)" : "Sync now"}
          </Button>
        )}
      </div>
      {errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
          <p className="font-medium">A connected source reported an error on its last sync.</p>
          <ul className="mt-1 space-y-1 text-xs">
            {errors.map((e) => (
              <li key={e.source}>
                <span className="font-medium">{LABEL[e.source] ?? e.source}</span>: {e.last_error}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">Nothing else on this page changes when a source fails — the panels below simply stop filling in.</p>
        </div>
      )}
    </div>
  );
}
