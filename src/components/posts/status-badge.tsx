import { Badge } from "@/components/ui/badge";
import type { PostStatus, TargetStatus } from "@/lib/posts/status";

const POST: Record<PostStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-muted text-foreground" },
  pending_approval: { label: "Pending approval", cls: "bg-amber-100 text-amber-900" },
  approved: { label: "Scheduled", cls: "bg-blue-100 text-blue-900" },
  publishing: { label: "Publishing", cls: "bg-amber-200 text-amber-900" },
  published: { label: "Published", cls: "bg-green-600 text-white" },
  failed: { label: "Failed", cls: "bg-red-600 text-white" },
  archived: { label: "Archived", cls: "bg-muted text-muted-foreground" },
};
const TARGET: Record<TargetStatus, { label: string; cls: string }> = {
  pending: { label: "Scheduled", cls: "bg-blue-100 text-blue-900" },
  publishing: { label: "Publishing", cls: "bg-amber-200 text-amber-900" },
  published: { label: "Published", cls: "bg-green-600 text-white" },
  failed: { label: "Failed", cls: "bg-red-600 text-white" },
};

export function PostStatusBadge({ status }: { status: PostStatus }) {
  const s = POST[status];
  return <Badge className={s.cls}>{s.label}</Badge>;
}
export function TargetStatusBadge({ status }: { status: TargetStatus }) {
  const s = TARGET[status];
  return <Badge className={s.cls}>{s.label}</Badge>;
}
