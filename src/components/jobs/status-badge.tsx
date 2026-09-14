import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/lib/ai/schemas";

const STYLE: Record<JobStatus, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-muted text-foreground" },
  claimed: { label: "Claimed", className: "bg-blue-100 text-blue-900" },
  running: { label: "Running", className: "bg-blue-100 text-blue-900 animate-pulse" },
  completed: { label: "Completed", className: "bg-green-100 text-green-900" },
  failed: { label: "Failed", className: "bg-red-100 text-red-900" },
};
export function JobStatusBadge({ status }: { status: JobStatus }) {
  const s = STYLE[status];
  return <Badge className={s.className}>{s.label}</Badge>;
}
