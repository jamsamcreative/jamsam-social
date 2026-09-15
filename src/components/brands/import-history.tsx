"use client";
import { useState, useTransition } from "react";
import { importHistoryAction } from "@/lib/plan/actions";
import { Button } from "@/components/ui/button";

export function ImportHistory({ brandId, syncedAt, rows }: { brandId: string; syncedAt: string | null; rows: number }) {
  const [log, setLog] = useState<string>("");
  const [pending, start] = useTransition();
  const run = () => start(async () => {
    let total = 0;
    for (const platform of ["facebook", "instagram"] as const) {
      for (let page = 0; page < 400; page++) {
        const r = await importHistoryAction(brandId, platform);
        if (!r.ok) { setLog(`${platform}: ${r.error}`); return; }
        total += r.data!.imported;
        setLog(`${platform}: ${total} posts so far…`);
        if (r.data!.done) break;
      }
    }
    setLog(`Done — ${total} posts imported`);
  });
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{rows} posts on file{syncedAt ? ` · last synced ${new Date(syncedAt).toLocaleString()}` : ""}. Nightly top-ups cover the last 30 days.</p>
      <Button type="button" variant="outline" disabled={pending} onClick={run}>{pending ? "Importing…" : "Import Meta history"}</Button>
      {log && <p className="text-sm">{log}</p>}
    </div>
  );
}
