"use client";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { scanAction, approveAction, rejectAction, undoAction } from "@/lib/links/actions";
import type { LinksBrand, SuggestionCard as SuggestionCardData, NoneCard as NoneCardData, AddedRow } from "@/lib/links/queries";
import { SuggestionCard } from "./suggestion-card";
import { NoneCard } from "./none-card";
import { AddedList } from "./added-list";

type Props = {
  brands: LinksBrand[];
  selectedSlug: string | null;
  scanTarget: string; // brand id, or "all"
  suggestions: SuggestionCardData[];
  none: NoneCardData[];
  added: AddedRow[];
};

/**
 * Owns the page's single `useTransition` (controller ruling from Task 8's review): Scan, Approve, Reject and Undo
 * all run through the same `busy` flag, so every action button on the page is disabled while any one of them is in
 * flight — two concurrent approvals on the same host post could otherwise lose a link. Renders everything below the
 * stat tiles: the scan control, the brand filter chips, and the three card sections.
 */
export function ScanCard({ brands, selectedSlug, scanTarget, suggestions, none, added }: Props) {
  const [busy, start] = useTransition();

  const runScan = () =>
    start(async () => {
      const r = await scanAction(scanTarget);
      if (!r.ok) return void toast.error(r.error);
      for (const m of r.data ?? []) (m.ok ? toast.success : toast.error)(`${m.brand}: ${m.message}`);
    });
  const runApprove = (id: string) =>
    start(async () => {
      const r = await approveAction(id);
      if (r.ok) toast.success(r.message ?? "Link added"); else toast.error(r.error);
    });
  const runReject = (id: string) =>
    start(async () => {
      const r = await rejectAction(id);
      if (r.ok) toast.success(r.message ?? "Rejected"); else toast.error(r.error);
    });
  const runUndo = (id: string) =>
    start(async () => {
      const r = await undoAction(id);
      if (r.ok) toast.success(r.message ?? "Link removed"); else toast.error(r.error);
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">Scan the sites</p>
              <p className="text-sm text-muted-foreground">Mirrors each brand&apos;s published posts and pages, rebuilds the link graph, and proposes one link per orphan.</p>
            </div>
            <Button size="sm" disabled={busy} onClick={runScan}>{busy ? "Scanning…" : "Scan for orphans"}</Button>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href="/blog/links" className={cn("rounded-md px-2 py-1", !selectedSlug ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>All brands</Link>
            {brands.map((b) => (
              <Link key={b.id} href={`/blog/links?brand=${b.slug}`} className={cn("rounded-md px-2 py-1", selectedSlug === b.slug ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>
                {b.name}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Awaiting review</h2>
        {suggestions.length === 0 ? (
          <p className="text-muted-foreground">Nothing to approve. The orphaned posts below need a link written by hand.</p>
        ) : (
          <div className="space-y-3">
            {suggestions.map((s) => (
              <SuggestionCard key={s.id} suggestion={s} disabled={busy} onApprove={() => runApprove(s.id)} onReject={() => runReject(s.id)} />
            ))}
          </div>
        )}
      </section>

      {none.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Orphaned with no suggestion ({none.length})</h2>
          <div className="space-y-3">
            {none.map((n) => <NoneCard key={n.id} none={n} />)}
          </div>
        </section>
      )}

      <AddedList rows={added} disabled={busy} onUndo={runUndo} />
    </div>
  );
}
