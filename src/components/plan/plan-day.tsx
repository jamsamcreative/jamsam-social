"use client";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatInZone } from "@/lib/time/zoned";
// `useInstead` is aliased so eslint's rules-of-hooks does not mistake it for a React hook.
import { approveDayAction, skipPlannedPostAction, useInsteadAction as swapForHistoryPost } from "@/lib/plan/actions";
import type { PlanDay as Day } from "@/lib/plan/queries";

const LANE: Record<string, string> = { new_page: "New page", recycle: "Recycle", promo: "Promo", filler: "Filler" };
const STATUS: Record<string, string> = { draft: "Waiting on Claude", pending_approval: "Ready to approve", approved: "Approved" };

export function PlanDay({ brandId, weekStart, day, tz }: { brandId: string; weekStart: string; day: Day; tz: string }) {
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => start(async () => { const r = await fn(); if (r.ok) toast.success(msg); else toast.error(r.error ?? "Failed"); });
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{day.label} <span className="font-normal text-muted-foreground">· {day.posts.length} planned</span></h2>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/posts/new?date=${day.date}`} />}>+ Add another</Button>
          <Button size="sm" variant="outline" disabled={pending || day.posts.every((p) => p.status !== "pending_approval")} onClick={() => act(() => approveDayAction(brandId, weekStart, day.date), "Day approved")}>Approve day</Button>
        </div>
      </div>
      {day.posts.length === 0 && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Nothing planned.</p>}
      {day.posts.map((p) => (
        <div key={p.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{LANE[p.plan.lane]}</Badge>
            <Link href={`/posts/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
            <Badge variant={p.status === "approved" ? "default" : "outline"}>{STATUS[p.status] ?? p.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{p.plan.reason}</p>
          <p className="mt-1 text-xs text-muted-foreground">{p.times.map((t) => `${t.platform === "facebook" ? "Facebook" : "Instagram"} ${formatInZone(t.at, tz)}`).join(" · ")}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/posts/${p.id}`} />}>Edit</Button>
            {p.status !== "approved" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => skipPlannedPostAction(p.id), "Skipped")}>Skip</Button>}
          </div>
          {day.onThisDay.length > 0 && p.status !== "approved" && (
            <div className="mt-3 rounded-md border border-dashed p-2">
              <p className="text-xs font-semibold uppercase">On this day in past years</p>
              {day.onThisDay.slice(0, 3).map((o) => (
                <div key={o.row.id} className="mt-1 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{o.row.caption.split("\n")[0] || "(no caption)"} <span className="text-xs text-muted-foreground">{o.row.published_at.slice(0, 10)} · {o.row.platform} · {o.label}</span></span>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => swapForHistoryPost(p.id, o.row.id), "Swapped in")}>Use this instead</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
