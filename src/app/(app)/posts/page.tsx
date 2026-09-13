import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { listPosts, type Post } from "@/lib/posts/queries";
import { PostRow } from "@/components/posts/post-row";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Posts" };

const FILTERS: { key: string; label: string; statuses?: Post["status"][] }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts", statuses: ["draft"] },
  { key: "pending", label: "Pending approval", statuses: ["pending_approval"] },
  { key: "scheduled", label: "Scheduled", statuses: ["approved", "publishing"] },
  { key: "published", label: "Published", statuses: ["published"] },
  { key: "failed", label: "Failed", statuses: ["failed"] },
  { key: "archived", label: "Archived", statuses: ["archived"] },
];

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];
  if (!brand) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Posts</h1>
        <p className="text-muted-foreground">
          Create a brand first.{" "}
          <Link className="underline" href="/brands/new">
            New brand
          </Link>
        </p>
      </div>
    );
  }
  const filter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const posts = await listPosts({ brandId: brand.id, status: filter.statuses });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Posts</h1>
          <p className="text-sm text-muted-foreground">{brand.name}. Switch brands in the header.</p>
        </div>
        <Button nativeButton={false} render={<Link href="/posts/new" />}>
          New post
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link key={f.key} href={f.key === "all" ? "/posts" : `/posts?status=${f.key}`} className={filter.key === f.key ? "font-medium underline" : "text-muted-foreground"}>
            {f.label}
          </Link>
        ))}
      </div>
      {posts.length === 0 ? (
        <p className="text-muted-foreground">No posts here yet.</p>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => (
            <PostRow key={p.id} post={p} />
          ))}
        </div>
      )}
    </div>
  );
}
