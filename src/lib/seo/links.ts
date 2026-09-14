import { tokens } from "./score";
import type { SitePageRef } from "./cannibalization";

/** Site pages sharing at least two meaningful tokens with the keyword or title; strongest overlap first. */
export function suggestInternalLinks(keyword: string, title: string, pages: SitePageRef[], limit = 5): (SitePageRef & { overlap: number })[] {
  const want = new Set([...tokens(keyword), ...tokens(title)]);
  return pages
    .map((p) => ({ ...p, overlap: new Set([...tokens(p.title), ...tokens(p.focus_keyword ?? "")].filter((t) => want.has(t))).size }))
    .filter((p) => p.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap || a.title.localeCompare(b.title))
    .slice(0, limit);
}
