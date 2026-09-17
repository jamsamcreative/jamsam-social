import "server-only";
import { UTILITY_SLUGS } from "./graph";
import { createSupabaseLinksStore, type LinksStore, type LinkSuggestionRow, type PageMeta } from "./store";

export type LinksBrand = { id: string; slug: string; name: string };
export type SuggestionCard = { id: string; orphanTitle: string; orphanUrl: string; hostTitle: string; hostUrl: string; phrase: string; context: string; brandName: string };
export type NoneCard = { id: string; orphanTitle: string; orphanUrl: string; reason: string; phrasesTried: string[]; brandName: string; utility?: boolean };
export type AddedRow = { id: string; orphanTitle: string; hostTitle: string; phrase: string; appliedAt: string; brandName: string };
export type LinksPageData = {
  brands: LinksBrand[];
  /** `pages` = site_pages mirrored, `pending` = awaiting review, `added` = approved links — for the selected brand, or every active brand. */
  stats: { pages: number; pending: number; added: number };
  /** Most recent `link_scan` across the selected brands, ISO, or null when never scanned. */
  lastScan: string | null;
  pending: SuggestionCard[];
  none: NoneCard[];
  added: AddedRow[];
};

const newestFirst = (a: string, b: string) => b.localeCompare(a);

/** Cards for one brand's rows, joining titles/urls from its `site_pages`. Rows whose pages have vanished from the mirror are skipped. */
function cardsFor(brand: LinksBrand, rows: LinkSuggestionRow[], pages: PageMeta[]): Pick<LinksPageData, "pending" | "none" | "added"> {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const out: Pick<LinksPageData, "pending" | "none" | "added"> = { pending: [], none: [], added: [] };
  for (const r of rows) {
    const orphan = byId.get(r.orphan_page_id);
    if (!orphan) continue;
    const host = r.host_page_id ? byId.get(r.host_page_id) : undefined;
    if (r.status === "pending" && host && r.phrase) {
      out.pending.push({ id: r.id, orphanTitle: orphan.title, orphanUrl: orphan.url, hostTitle: host.title, hostUrl: host.url, phrase: r.phrase, context: r.context ?? "", brandName: brand.name });
    } else if (r.status === "none") {
      const utility = orphan.type === "page" && UTILITY_SLUGS.has(orphan.slug);
      out.none.push({ id: r.id, orphanTitle: orphan.title, orphanUrl: orphan.url, reason: r.reason ?? "", phrasesTried: r.phrases_tried ?? [], brandName: brand.name, ...(utility ? { utility } : {}) });
    } else if (r.status === "approved" && host && r.phrase) {
      out.added.push({ id: r.id, orphanTitle: orphan.title, hostTitle: host.title, phrase: r.phrase, appliedAt: r.applied_at ?? r.updated_at, brandName: brand.name });
    }
  }
  return out;
}

/** Everything `/blog/links` renders. `brandSlug` null (or unknown) aggregates every active brand. */
export async function getLinksPageData(brandSlug: string | null, store: LinksStore = createSupabaseLinksStore()): Promise<LinksPageData> {
  const brands = await store.listActiveBrands();
  const selected = brandSlug ? brands.filter((b) => b.slug === brandSlug) : brands;
  const scope = selected.length === 1 ? selected : brands;
  const data: LinksPageData = { brands, stats: { pages: 0, pending: 0, added: 0 }, lastScan: null, pending: [], none: [], added: [] };
  const scans: string[] = [];
  for (const brand of scope) {
    const [rows, pages, last, counts] = await Promise.all([
      store.listSuggestions(brand.id, ["pending", "none", "approved"]),
      store.listPageMeta(brand.id),
      store.lastScan(brand.id),
      store.counts(brand.id),
    ]);
    const cards = cardsFor(brand, rows, pages);
    data.pending.push(...cards.pending);
    data.none.push(...cards.none);
    data.added.push(...cards.added);
    data.stats.pages += counts.pages;
    data.stats.pending += counts.pending;
    data.stats.added += counts.added;
    if (last) scans.push(last);
  }
  data.lastScan = scans.sort(newestFirst)[0] ?? null;
  data.pending.sort((a, b) => a.orphanTitle.localeCompare(b.orphanTitle));
  data.none.sort((a, b) => Number(!!a.utility) - Number(!!b.utility) || a.orphanTitle.localeCompare(b.orphanTitle)); // utility pages last
  data.added.sort((a, b) => newestFirst(a.appliedAt, b.appliedAt));
  return data;
}
