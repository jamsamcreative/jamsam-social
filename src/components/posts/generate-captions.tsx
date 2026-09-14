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

  useEffect(() => {
    if (!jobId) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { status: string; result: CaptionResult | null; error: string | null };
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
  };
  return (
    <Button type="button" variant="outline" disabled={!!jobId} onClick={start}>
      {jobId ? "Writing captions…" : "✨ Write captions"}
    </Button>
  );
}
