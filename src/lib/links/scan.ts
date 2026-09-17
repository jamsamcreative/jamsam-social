import { mirrorBrandSite } from "@/lib/seo/run";
import { buildEdges, findOrphans } from "./graph";
import { isSuggestion, type LinksStore, type PageWithHtml } from "./store";
import { suggestFor } from "./suggest";
import type { NoneVerdict, Suggestion } from "./types";

/** What the scan needs from a mirror run: the page identity (to join with `site_pages`) and the raw HTML (to build the graph). */
export type MirroredForScan = { wp_id: number; type: "post" | "page"; url: string; content_html: string };
export type ScanMirror = (brandId: string) => Promise<{ pages: number; mirrored: MirroredForScan[] } | { error: string }>;
export type ScanResult = { pages: number; links: number; orphans: number; suggested: number; none: number };

const originOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try { return new URL(url).origin; } catch { return null; }
};

/**
 * One brand's scan: mirror the site (writes `site_pages`), rebuild `site_links` from the mirrored HTML,
 * find orphans, propose one link (or a `none` verdict) per orphan, reconcile `link_suggestions`, and log a
 * `link_scan` import ("N pages, M links, K orphans"). A mirror failure returns `{ error }` and leaves the graph untouched.
 */
export async function scanBrand(store: LinksStore, i: { brandId: string; userId: string | null; mirror?: ScanMirror }): Promise<ScanResult | { error: string }> {
  const mirror = i.mirror ?? mirrorBrandSite;
  const m = await mirror(i.brandId);
  if ("error" in m) return { error: m.error };

  const html = new Map(m.mirrored.map((p) => [`${p.type}:${p.wp_id}`, p.content_html]));
  const pages: PageWithHtml[] = (await store.listPages(i.brandId)).map((p) => ({ ...p, content_html: html.get(`${p.type}:${p.wp_id}`) ?? "" }));

  const brand = await store.getBrand(i.brandId);
  const siteOrigin = originOf(brand?.website_url) ?? originOf(m.mirrored[0]?.url);
  const edges = siteOrigin ? buildEdges(pages, siteOrigin) : [];
  await store.replaceEdges(i.brandId, edges);

  const orphans = findOrphans(pages, edges);
  const results: (Suggestion | NoneVerdict)[] = [];
  for (const { page } of orphans) {
    const rejected = await store.rejectedKeys(i.brandId, page.id);
    results.push(suggestFor(page, pages, edges, rejected));
  }
  await store.upsertScanResults(i.brandId, results, orphans.map((o) => o.page.id));

  const suggested = results.filter(isSuggestion).length;
  await store.logScan(i.brandId, `${pages.length} pages, ${edges.length} links, ${orphans.length} orphans`, orphans.length, i.userId);
  return { pages: pages.length, links: edges.length, orphans: orphans.length, suggested, none: results.length - suggested };
}
