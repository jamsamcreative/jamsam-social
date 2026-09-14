import { notFound } from "next/navigation";
import { getArticle } from "@/lib/articles/queries";
import { getBrandBySlug } from "@/lib/brands/queries";
import { listMediaAssets } from "@/lib/media/queries";
import { getWpTerms } from "@/lib/wordpress/terms";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import type { WordpressConfig } from "@/lib/connections/wordpress-shared";
import { ArticleForm } from "@/components/articles/article-form";
import { ArticleActions } from "@/components/articles/article-actions";
import { ArticleStatusBadge } from "@/components/articles/status-badge";
import { formatInZone } from "@/lib/time/zoned";

export const maxDuration = 300;

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await getArticle(id);
  if (!article) notFound();
  const brand = await getBrandBySlug(article.brand.slug);
  if (!brand) notFound();
  const [assets, terms, wp] = await Promise.all([
    listMediaAssets(brand.id),
    getWpTerms(brand.id).catch(() => null),
    getConnectionWithSecret<WordpressConfig, unknown>(brand.id, "wordpress").catch(() => null),
  ]);
  const wpAdminUrl = wp && article.wp_post_id ? `${wp.config.site_url.replace(/\/+$/, "")}/wp-admin/post.php?post=${article.wp_post_id}&action=edit` : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{article.title}</h1>
            <ArticleStatusBadge status={article.status} wpStatus={article.wp_status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {article.brand.name}
            {article.pushed_at && ` · pushed ${formatInZone(article.pushed_at, brand.timezone)}`}
            {article.wp_link && (
              <>
                {" "}·{" "}
                <a href={article.wp_link} target="_blank" rel="noreferrer" className="underline">
                  {article.status === "published" ? "View live" : "WP preview link"}
                </a>
              </>
            )}
          </p>
          {article.last_error && <p className="text-sm text-destructive">Last error: {article.last_error}</p>}
        </div>
        <ArticleActions article={article} wpAdminUrl={wpAdminUrl} />
      </div>
      <ArticleForm brand={brand} article={article} assets={assets} terms={terms} />
    </div>
  );
}
