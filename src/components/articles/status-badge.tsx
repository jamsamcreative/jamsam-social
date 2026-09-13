import { Badge } from "@/components/ui/badge";
import type { Database } from "@/lib/database.types";

type S = Database["public"]["Enums"]["article_status"];
const MAP: Record<S, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-muted text-foreground" },
  pushed_to_wp: { label: "In WordPress (draft)", cls: "bg-blue-100 text-blue-900" },
  published: { label: "Published", cls: "bg-green-600 text-white" },
  archived: { label: "Archived", cls: "bg-muted text-muted-foreground" },
};
export function ArticleStatusBadge({ status, wpStatus }: { status: S; wpStatus?: string | null }) {
  const s = MAP[status];
  const label = status === "published" && wpStatus === "future" ? "Scheduled in WordPress" : s.label;
  return <Badge className={s.cls}>{label}</Badge>;
}
