import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { listConnectionsForBrand } from "@/lib/connections/queries";
import { listKeywordsForBrand, listSitePagesForBrand, listProjectsForBrand, listImportsForBrand, listArticleTargets } from "@/lib/seo/queries";
import { dataFreshness } from "@/lib/seo/freshness";
import { normaliseKeyword } from "@/lib/seo/score";
import { OpportunitiesTable } from "@/components/seo/opportunities-table";
import { KeywordMap } from "@/components/seo/keyword-map";
import { ContentBank } from "@/components/seo/content-bank";
import { Imports } from "@/components/seo/imports";
import { cn } from "@/lib/utils";

export const metadata = { title: "SEO" };
export const maxDuration = 300;

const TABS = [["opportunities", "Opportunities"], ["map", "Keyword map"], ["bank", "Content bank"], ["imports", "Imports"]] as const;

export default async function SeoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as (typeof TABS)[number][0]) : "opportunities";
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];
  if (!brand) return <p className="text-muted-foreground">Create a brand first. <Link className="underline" href="/brands/new">New brand</Link></p>;
  const [connections, imports] = await Promise.all([listConnectionsForBrand(brand.id), listImportsForBrand(brand.id)]);
  const has = (p: string) => connections.some((c) => c.provider === p && c.status === "connected");

  let body: React.ReactNode;
  if (tab === "opportunities") {
    const [keywords, articles] = await Promise.all([listKeywordsForBrand(brand.id), listArticleTargets(brand.id)]);
    body = <OpportunitiesTable brandId={brand.id} keywords={keywords} targeted={articles.map((a) => a.primary_keyword && normaliseKeyword(a.primary_keyword)).filter((x): x is string => Boolean(x))} freshness={dataFreshness(imports)} />;
  } else if (tab === "map") {
    const [keywords, articles, pages] = await Promise.all([listKeywordsForBrand(brand.id), listArticleTargets(brand.id), listSitePagesForBrand(brand.id)]);
    body = <KeywordMap articles={articles} pages={pages} keywords={keywords} />;
  } else if (tab === "bank") {
    const { rows, categories, states } = await listProjectsForBrand(brand.id, { q: sp.q, category: sp.category, state: sp.state });
    body = <ContentBank rows={rows} categories={categories} states={states} />;
  } else {
    body = <Imports brandId={brand.id} siteUrl={brand.website_url ?? ""} imports={imports} hasSemrush={has("semrush")} hasWordpress={has("wordpress")} hasGsc={has("search_console")} />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">SEO</h1>
        <p className="text-sm text-muted-foreground">{brand.name}. What to write next, what already exists, and the source material to write it from.</p>
      </div>
      <nav className="flex gap-1 rounded-lg border p-1 text-sm w-fit">
        {TABS.map(([k, label]) => <Link key={k} href={`/seo?tab=${k}`} className={cn("rounded-md px-3 py-1", tab === k ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>{label}</Link>)}
      </nav>
      {body}
    </div>
  );
}
