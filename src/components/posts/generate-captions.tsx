"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { enqueueJob } from "@/lib/jobs/actions";
import type { CaptionResult } from "@/lib/ai/schemas";

type Props = { brandId: string; ensureSaved: () => Promise<string | null>; onResult: (r: CaptionResult) => void };

/** "Write captions": saves the draft, queues a caption job, polls it, and hands the captions back to the form. */
export function GenerateCaptions({ brandId, ensureSaved, onResult }: Props) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [runner, setRunner] = useState<"in_app" | "mcp" | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { status: string; runner: "in_app" | "mcp"; result: CaptionResult | null; error: string | null };
      setRunner(j.runner);
      if (j.status === "completed" && j.result) {
        onResult(j.result);
        toast.success("Captions written — review before submitting");
        setJobId(null);
      } else if (j.status === "failed") {
        toast.error(j.error ?? "Caption job failed");
        setJobId(null);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [jobId, onResult]);

  const start = async () => {
    const postId = await ensureSaved();
    if (!postId) return;
    const r = await enqueueJob({ brandId, type: "caption", input: { post_id: postId } });
    if (!r.ok) return void toast.error(r.error);
    setJobId(r.id ?? null);
    toast.info("Caption job queued — if it's on the MCP runner, run it from your Claude session and keep this page open");
  };
  const waitingOnMcp = !!jobId && runner === "mcp";
  return (
    <div className="flex items-center gap-3">
      <Button type="button" variant="outline" disabled={!!jobId} onClick={start}>
        {jobId ? (waitingOnMcp ? "Waiting for your Claude session…" : "Writing captions…") : "✨ Write captions"}
      </Button>
      {waitingOnMcp && <p className="text-xs text-muted-foreground">Tell Claude: &quot;check jamsam jobs and do the queued ones&quot;. See Jobs for the connect command.</p>}
    </div>
  );
}
