"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Platform } from "@/lib/posts/status";
import { moveKeepingTime } from "@/lib/calendar/grid";
import { rescheduleTarget } from "@/lib/posts/actions";
import { reschedulePin } from "@/lib/pins/actions";
import { utcToZonedLocal } from "@/lib/time/zoned";
import { cn } from "@/lib/utils";

export type Chip = {
  id: string;
  post_id: string;
  title: string;
  platform: Platform | "pinterest";
  status: "pending" | "publishing" | "published" | "failed";
  scheduled_at: string;
  movable: boolean;
  href?: string;
};

const STATUS_CLS: Record<Chip["status"], string> = {
  pending: "bg-blue-100 text-blue-900 border-blue-200",
  publishing: "bg-amber-200 text-amber-900 border-amber-300",
  published: "bg-green-100 text-green-900 border-green-200",
  failed: "bg-red-100 text-red-900 border-red-200",
};

export function MonthGrid({ days, chipsByDay, timezone, today }: { days: { date: string; inMonth: boolean }[]; chipsByDay: Record<string, Chip[]>; timezone: string; today: string }) {
  const [dragging, setDragging] = useState<Chip | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function drop(day: string) {
    if (!dragging || !dragging.movable) return;
    const chip = dragging;
    setDragging(null);
    const newIso = moveKeepingTime(chip.scheduled_at, day, timezone);
    start(async () => {
      const r = chip.platform === "pinterest" ? await reschedulePin(chip.id, newIso) : await rescheduleTarget(chip.id, newIso);
      if (r.ok) {
        toast.success("Rescheduled");
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <div className={cn("grid grid-cols-7 overflow-hidden rounded-lg border text-xs", pending && "opacity-70")}>
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
        <div key={d} className="border-b bg-muted/40 p-2 text-center font-medium text-muted-foreground">
          {d}
        </div>
      ))}
      {days.map((d) => (
        <div
          key={d.date}
          onDragOver={(e) => dragging?.movable && e.preventDefault()}
          onDrop={() => drop(d.date)}
          className={cn("min-h-24 border-b border-r p-1", !d.inMonth && "bg-muted/20 text-muted-foreground", d.date === today && "bg-yellow-50")}
        >
          <div className="mb-1 text-right text-[11px]">{Number(d.date.slice(8))}</div>
          <div className="space-y-1">
            {(chipsByDay[d.date] ?? []).map((c) => (
              <Link
                key={c.id}
                href={c.href ?? `/posts/${c.post_id}`}
                draggable={c.movable}
                onDragStart={() => setDragging(c)}
                onDragEnd={() => setDragging(null)}
                title={`${c.title} · ${c.platform} · ${c.status}`}
                className={cn("block truncate rounded border px-1 py-0.5", STATUS_CLS[c.status], c.movable && "cursor-grab")}
              >
                <span className="font-mono">{c.platform === "facebook" ? "FB" : c.platform === "instagram" ? "IG" : c.platform === "pinterest" ? "PIN" : "GBP"}</span> {utcToZonedLocal(c.scheduled_at, timezone).slice(11)} {c.title}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
