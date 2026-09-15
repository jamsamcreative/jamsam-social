"use client";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { buildWeekAction, rebuildWeekAction, approveWeekAction } from "@/lib/plan/actions";

type Props = { brandId: string; brandSlug: string; weekStart: string; thisWeek: string; prev: string; next: string; built: boolean; timingSource: string | null; summary: Record<string, number> | null; counts: { total: number; ready: number; waiting: number; approved: number }; weeksOnFile: number; emptyDays: string[] };

export function WeekToolbar(p: Props) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, done: (d: unknown) => string) => start(async () => { const r = await fn(); if (r.ok) toast.success(done(r.data)); else toast.error(r.error ?? "Failed"); });
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/plan?week=${p.prev}`} />}>← Previous</Button>
        <span className="font-medium">Week of {p.weekStart}{p.weekStart === p.thisWeek ? " (this week)" : ""}</span>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/plan?week=${p.next}`} />}>Next →</Button>
        <span className="text-xs text-muted-foreground">{p.weeksOnFile} planned week{p.weeksOnFile === 1 ? "" : "s"} on file</span>
      </div>
      {p.summary && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">{p.summary.new_page} new pages</Badge><Badge variant="secondary">{p.summary.recycle} recycles</Badge><Badge variant="secondary">{p.summary.promo} promos</Badge><Badge variant="secondary">{p.summary.filler} filler</Badge>
        </div>
      )}
      {p.timingSource && <p className="text-xs text-muted-foreground">Timing source: {p.timingSource}.{p.emptyDays.length ? ` No candidate for ${p.emptyDays.join(", ")}.` : ""}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {!p.built ? (
          <Button size="sm" disabled={pending} onClick={() => run(() => buildWeekAction(p.brandId, p.weekStart), (d) => `Built ${(d as { created: number }).created} posts`)}>Build this week</Button>
        ) : (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rebuildWeekAction(p.brandId, p.weekStart), (d) => `Rebuilt: removed ${(d as { removed: number }).removed}, created ${(d as { created: number }).created}`)}>Rebuild this week</Button>
        )}
        <span className="text-sm">{p.counts.approved} of {p.counts.total} approved · {p.counts.ready} ready · {p.counts.waiting} waiting on Claude</span>
        <Button size="sm" disabled={pending || p.counts.ready === 0} onClick={() => run(() => approveWeekAction(p.brandId, p.weekStart), (d) => `Approved ${(d as { approved: number }).approved}; ${(d as { waiting: number }).waiting} still need captions`)}>Approve week</Button>
        <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/brands/${p.brandSlug}`} />}>Schedule</Button>
      </div>
      <p className="text-xs text-muted-foreground">Rebuilding discards untouched drafts and starts over. Anything you approved or edited is kept. Approve buttons only act on posts that already have captions.</p>
    </div>
  );
}
