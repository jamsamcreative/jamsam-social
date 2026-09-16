import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { listArticles, type Article } from "@/lib/articles/queries";
import { ArticleStatusBadge } from "@/components/articles/status-badge";
import { Button } from "@/components/ui/button";
import { NewFromBrief } from "@/components/articles/new-from-brief";
import { getDefaultRunner } from "@/lib/settings/queries";
import { formatInZone } from "@/lib/time/zoned";
import { SemrushFreshness } from "@/components/seo/semrush-freshness";

export const metadata = { title: "Blog" };
export const maxDuration = 300;

const FILTERS: { key: string; label: string; statuses?: Article["status"][] }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts", statuses: ["draft"] },
  { key: "pushed", label: "In WordPress", statuses: ["pushed_to_wp"] },
  { key: "published", label: "Published", statuses: ["published"] },
  { key: "archived", label: "Archived", statuses: ["archived"] },
];

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];
  if (!brand) {
    return (
      <p className="text-muted-foreground">
        Create a brand first.{" "}
        <Link className="underline" href="/brands/new">
          New brand
        </Link>
      </p>
    );
  }
  const filter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const [articles, defaultRunner] = await Promise.all([listArticles({ brandId: brand.id, status: filter.statuses }), getDefaultRunner()]);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Blog</h1>
          <p className="text-sm text-muted-foreground">{brand.name}. Switch brands in the header.</p>
        </div>
        <div className="flex gap-2">
          <NewFromBrief brandId={brand.id} defaultRunner={defaultRunner} />
          <Button nativeButton={false} render={<Link href="/blog/new" />}>
            New blog post
          </Button>
        </div>
      </div>
      <SemrushFreshness brands={brands} />
      <div className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link key={f.key} href={f.key === "all" ? "/blog" : `/blog?status=${f.key}`} className={filter.key === f.key ? "font-medium underline" : "text-muted-foreground"}>
            {f.label}
          </Link>
        ))}
      </div>
      {articles.length === 0 ? (
        <p className="text-muted-foreground">No blog posts here yet.</p>
      ) : (
        <div className="space-y-2">
          {articles.map((a) => (
            <Link key={a.id} href={`/blog/${a.id}`} className="flex items-center gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/40">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{a.title}</span>
                  <ArticleStatusBadge status={a.status} wpStatus={a.wp_status} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  /{a.slug} · updated {formatInZone(a.updated_at, brand.timezone)}
                  {a.primary_keyword ? ` · ${a.primary_keyword}` : ""}
                </p>
              </div>
              {a.wp_link && (
                <span className="text-xs text-muted-foreground">
                  in WP
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
