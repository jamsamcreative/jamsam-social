import { Badge } from "@/components/ui/badge";
import type { PinStatus } from "@/lib/pins/queries";

const STYLE: Record<PinStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-foreground" },
  pending_approval: { label: "Awaiting approval", className: "bg-amber-100 text-amber-900" },
  approved: { label: "Scheduled", className: "bg-blue-100 text-blue-900" },
  publishing: { label: "Publishing", className: "bg-amber-200 text-amber-900 animate-pulse" },
  published: { label: "Published", className: "bg-green-100 text-green-900" },
  failed: { label: "Failed", className: "bg-red-100 text-red-900" },
  archived: { label: "Archived", className: "bg-muted text-muted-foreground" },
};
export function PinStatusBadge({ status }: { status: PinStatus }) {
  const s = STYLE[status];
  return <Badge className={s.className}>{s.label}</Badge>;
}
