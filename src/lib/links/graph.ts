import { extractInternalLinks, normaliseUrl } from "./html";
import type { LinkEdge, Orphan, PageLite } from "./types";

export const UTILITY_SLUGS = new Set(["privacy-policy", "privacy", "terms", "terms-of-service", "thank-you", "sitemap", "front-page", "home"]);

/** Edges from every page's body links; `siteOrigins` lists each host the site answers on (see `normaliseUrl`). */
export function buildEdges(pages: (PageLite & { content_html: string })[], siteOrigins: string | string[]): LinkEdge[] {
  const byUrl = new Map<string, string>();
  const bySlug = new Map<string, string>();
  for (const p of pages) {
    const u = normaliseUrl(p.url, siteOrigins);
    if (u) byUrl.set(u, p.id);
    bySlug.set(p.slug, p.id);
  }
  const edges: LinkEdge[] = [];
  for (const p of pages) {
    for (const l of extractInternalLinks(p.content_html, siteOrigins)) {
      const slug = l.href.split("/").filter(Boolean).pop() ?? "";
      const to = byUrl.get(l.href) ?? bySlug.get(slug);
      if (!to || to === p.id) continue;
      edges.push({ from_page_id: p.id, to_page_id: to, href: l.href, anchor_text: l.anchorText });
    }
  }
  return edges;
}

export function findOrphans(pages: PageLite[], edges: LinkEdge[]): Orphan[] {
  const inbound = new Set(edges.filter((e) => e.from_page_id !== e.to_page_id).map((e) => e.to_page_id));
  return pages
    .filter((p) => !inbound.has(p.id))
    .map((page) => ({ page, utility: page.type === "page" && UTILITY_SLUGS.has(page.slug) }))
    .sort((a, b) => Number(a.utility) - Number(b.utility) || a.page.title.localeCompare(b.page.title));
}
