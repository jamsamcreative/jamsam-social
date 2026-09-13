import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost } from "@/lib/posts/queries";
import { listMediaAssets } from "@/lib/media/queries";
import { getBrandBySlug } from "@/lib/brands/queries";
import { PostForm } from "@/components/posts/post-form";
import { PostActions } from "@/components/posts/post-actions";
import { PostStatusBadge, TargetStatusBadge } from "@/components/posts/status-badge";
import { PLATFORM_LABELS } from "@/lib/posts/status";
import { formatInZone } from "@/lib/time/zoned";
import type { MediaItem } from "@/lib/database.types";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) notFound();
  const brand = await getBrandBySlug(post.brand.slug);
  if (!brand) notFound();
  const editable = !["publishing", "published", "archived"].includes(post.status);
  const media = (post.media as MediaItem[] | null) ?? [];
  const tz = post.brand.timezone;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{post.title}</h1>
            <PostStatusBadge status={post.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {post.brand.name}
            {post.source === "recycled" && post.recycled_from && (
              <>
                {" "}· recycled from{" "}
                <Link href={`/posts/${post.recycled_from}`} className="underline">
                  original
                </Link>
              </>
            )}
          </p>
        </div>
        <PostActions post={post} />
      </div>

      <section className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Platform</th>
              <th className="p-2">Scheduled ({tz})</th>
              <th className="p-2">Status</th>
              <th className="p-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {post.targets.length === 0 && (
              <tr>
                <td className="p-2 text-muted-foreground" colSpan={4}>
                  No platforms enabled yet.
                </td>
              </tr>
            )}
            {post.targets.map((t) => {
              const ins = t.insights as { likes?: number; comments?: number; shares?: number; reach?: number; saved?: number; fetched_at?: string } | null;
              return (
                <tr key={t.id} className="border-t align-top">
                  <td className="p-2 font-medium">{PLATFORM_LABELS[t.platform]}</td>
                  <td className="p-2">{t.scheduled_at ? formatInZone(t.scheduled_at, tz) : "Not set"}</td>
                  <td className="p-2">
                    <TargetStatusBadge status={t.status} />
                    {t.attempts > 0 && t.status !== "published" && <span className="ml-1 text-xs text-muted-foreground">attempt {t.attempts}/3</span>}
                  </td>
                  <td className="p-2">
                    {t.external_url && (
                      <a href={t.external_url} target="_blank" rel="noreferrer" className="underline">
                        View post
                      </a>
                    )}
                    {t.error && <p className="text-destructive">{t.error}</p>}
                    {ins && (
                      <p className="text-xs text-muted-foreground">
                        ♥ {ins.likes ?? 0} · 💬 {ins.comments ?? 0}
                        {ins.shares !== undefined ? ` · ↗ ${ins.shares}` : ""}
                        {ins.saved !== undefined ? ` · 🔖 ${ins.saved}` : ""}
                        {ins.reach !== undefined ? ` · reach ${ins.reach}` : ""}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {editable ? (
        <PostForm brand={brand} post={post} assets={await listMediaAssets(brand.id)} />
      ) : (
        <section className="space-y-4">
          {media.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {media.map((m) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={m.url} src={m.url} alt={m.alt ?? ""} className="h-32 w-32 rounded-md border object-cover" />
              ))}
            </div>
          )}
          {post.link_url && (
            <p className="text-sm">
              Link:{" "}
              <a href={post.link_url} className="underline" target="_blank" rel="noreferrer">
                {post.link_url}
              </a>
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {post.targets.map((t) => (
              <div key={t.id} className="rounded-lg border p-4">
                <p className="mb-2 font-medium">{PLATFORM_LABELS[t.platform]}</p>
                <p className="whitespace-pre-wrap text-sm">{t.caption}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
