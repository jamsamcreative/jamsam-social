"use client";
import Link from "next/link";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { JobStatusBadge } from "./status-badge";
import { retryJob, cancelJob, type ActionResult } from "@/lib/jobs/actions";
import { formatInZone } from "@/lib/time/zoned";
import type { GenerationJob } from "@/lib/jobs/queries";

const TYPE_LABEL = { caption: "Captions", article: "Article", promo: "Promo post", rewrite: "Rewrite", seo_cluster: "Keyword clusters" } as const;

function duration(j: GenerationJob): string {
  if (!j.started_at) return "";
  const end = j.finished_at ? Date.parse(j.finished_at) : Date.now();
  return `${Math.round((end - Date.parse(j.started_at)) / 1000)}s`;
}

export function JobsTable({ jobs, timezone }: { jobs: GenerationJob[]; timezone: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = jobs.some((j) => ["queued", "claimed", "running"].includes(j.status));
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [active, router]);
  const run = (fn: () => Promise<ActionResult>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        router.refresh();
      } else toast.error(r.error);
    });
  const output = (j: GenerationJob) =>
    j.article_id ? (
      <Link className="underline" href={`/articles/${j.article_id}`}>Article</Link>
    ) : j.post_id ? (
      <Link className="underline" href={`/posts/${j.post_id}`}>Post</Link>
    ) : null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-2">Type</th><th className="p-2">Status</th><th className="p-2">Runner</th><th className="p-2">Created</th>
            <th className="p-2">Duration</th><th className="p-2">Tokens in / out</th><th className="p-2">Output</th><th className="p-2">Error</th><th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 && (
            <tr><td className="p-3 text-muted-foreground" colSpan={9}>No jobs yet.</td></tr>
          )}
          {jobs.map((j) => (
            <tr key={j.id} className="border-t align-top">
              <td className="p-2 font-medium">{TYPE_LABEL[j.type]}</td>
              <td className="p-2"><JobStatusBadge status={j.status} /></td>
              <td className="p-2">{j.runner === "mcp" ? "MCP" : "In-app"}</td>
              <td className="p-2 whitespace-nowrap">{formatInZone(j.created_at, timezone)}</td>
              <td className="p-2">{duration(j)}</td>
              <td className="p-2 whitespace-nowrap">{j.input_tokens != null ? `${j.input_tokens} / ${j.output_tokens ?? 0}` : ""}</td>
              <td className="p-2">{output(j)}</td>
              <td className="max-w-xs p-2 text-destructive" title={j.error ?? undefined}>{j.error ? (j.error.length > 80 ? j.error.slice(0, 80) + "…" : j.error) : ""}</td>
              <td className="p-2">
                {j.status === "failed" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryJob(j.id), "Re-queued")}>Retry</Button>}
                {j.status === "queued" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelJob(j.id), "Cancelled")}>Cancel</Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
