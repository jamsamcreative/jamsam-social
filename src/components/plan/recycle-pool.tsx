"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RecyclePool({ pool }: { pool: { id: string; title: string; interactions: number; published_at: string; platform: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "What's in the recycle pool?"} ({pool.length})</Button>
      {open && (
        <ul className="mt-2 divide-y rounded-lg border text-sm">
          {pool.length === 0 && <li className="p-2 text-muted-foreground">Nothing rested and proven yet — import Meta history or wait for posts to age past the rest window.</li>}
          {pool.map((r) => <li key={r.id} className="flex justify-between gap-2 p-2"><span className="truncate">{r.title}</span><span className="shrink-0 text-muted-foreground">{r.platform} · {r.interactions} interactions · {r.published_at.slice(0, 10)}</span></li>)}
        </ul>
      )}
    </div>
  );
}
