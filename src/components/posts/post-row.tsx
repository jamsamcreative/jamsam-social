import Link from "next/link";
import { PostStatusBadge, TargetStatusBadge } from "./status-badge";
import { formatInZone } from "@/lib/time/zoned";
import { PLATFORM_LABELS } from "@/lib/posts/status";
import type { PostWithTargets } from "@/lib/posts/queries";
import type { MediaItem } from "@/lib/database.types";

type Insights = { likes?: number; comments?: number } | null;

export function insightsSummary(post: PostWithTargets): string | null {
  const withData = post.targets.filter((t) => t.insights);
  if (withData.length === 0) return null;
  const likes = withData.reduce((n, t) => n + ((t.insights as Insights)?.likes ?? 0), 0);
  const comments = withData.reduce((n, t) => n + ((t.insights as Insights)?.comments ?? 0), 0);
  return `♥ ${likes} · 💬 ${comments}`;
}

export function PostRow({ post }: { post: PostWithTargets }) {
  const cover = ((post.media as MediaItem[] | null) ?? [])[0];
  const insights = insightsSummary(post);
  return (
    <Link href={`/posts/${post.id}`} className="flex gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/40">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {cover && <img src={cover.url} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{post.title}</span>
          <PostStatusBadge status={post.status} />
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {post.targets.map((t) => (
            <span key={t.id} className="flex items-center gap-1">
              {PLATFORM_LABELS[t.platform]}
              {t.scheduled_at && <span>{formatInZone(t.scheduled_at, post.brand.timezone)}</span>}
              <TargetStatusBadge status={t.status} />
            </span>
          ))}
          {insights && <span>{insights}</span>}
        </div>
      </div>
    </Link>
  );
}
