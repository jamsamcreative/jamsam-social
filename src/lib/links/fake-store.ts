// In-memory LinksStore used by Internal Links tests. Never imported by app code.
import { groupRejected, planScanUpsert, type LinksStore, type LinkSuggestionRow } from "./store";
import type { LinkEdge, PageLite } from "./types";

export const BRAND = { id: "b1", slug: "acme", name: "Acme", website_url: "https://acme.com" };

export type FakePage = PageLite & { brand_id: string };
export type FakeLinksStore = LinksStore & {
  pages: FakePage[];
  edges: (LinkEdge & { brand_id: string })[];
  suggestions: LinkSuggestionRow[];
  imports: { brand_id: string; kind: string; detail: string | null; rows: number; created_by: string | null; created_at: string }[];
};

let wp = 100;
/** A published post on the fake brand; override any field. `wp_id` and `url` derive from the id. */
export function page(id: string, over: Partial<FakePage> = {}): FakePage {
  return { id, brand_id: BRAND.id, wp_id: ++wp, type: "post", slug: id, url: `${BRAND.website_url}/${id}`, title: id, focus_keyword: null, content_text: "", modified_at: null, ...over };
}

const omitBrand = <T extends { brand_id: string }>(x: T): Omit<T, "brand_id"> => { const r: Partial<T> = { ...x }; delete r.brand_id; return r as Omit<T, "brand_id">; };

export function fakeLinksStore(seed: { pages?: FakePage[]; brands?: { id: string; slug: string; name: string; website_url: string | null }[] } = {}): FakeLinksStore {
  let n = 0;
  const brands = seed.brands ?? [BRAND];
  const now = () => new Date().toISOString();
  const store: FakeLinksStore = {
    pages: seed.pages ?? [], edges: [], suggestions: [], imports: [],
    async getBrand(id) { return brands.find((b) => b.id === id) ?? null; },
    async listActiveBrands() { return brands.map(({ id, slug, name }) => ({ id, slug, name })); },
    async listPages(brandId) { return store.pages.filter((p) => p.brand_id === brandId).map(omitBrand); },
    async listPageMeta(brandId) { return store.pages.filter((p) => p.brand_id === brandId).map(({ id, type, slug, url, title }) => ({ id, type, slug, url, title })); },
    async getPage(id) { const p = store.pages.find((x) => x.id === id); return p ? omitBrand(p) : null; },
    async replaceEdges(brandId, edges) { store.edges = [...store.edges.filter((e) => e.brand_id !== brandId), ...edges.map((e) => ({ brand_id: brandId, ...e }))]; },
    async addEdge(brandId, edge) { store.edges.push({ brand_id: brandId, ...edge }); },
    async removeEdge(brandId, fromId, toId, href) { store.edges = store.edges.filter((e) => !(e.brand_id === brandId && e.from_page_id === fromId && e.to_page_id === toId && e.href === href)); },
    async listEdges(brandId) { return store.edges.filter((e) => e.brand_id === brandId).map(omitBrand); },
    async listSuggestions(brandId, statuses) { return store.suggestions.filter((s) => s.brand_id === brandId && (!statuses?.length || statuses.includes(s.status))); },
    async getSuggestion(id) { return store.suggestions.find((s) => s.id === id) ?? null; },
    async rejectedKeys(brandId, orphanId) {
      return new Set(store.suggestions.filter((s) => s.brand_id === brandId && s.orphan_page_id === orphanId && s.status === "rejected" && s.host_page_id && s.phrase).map((s) => `${s.host_page_id}|${s.phrase}`));
    },
    async rejectedKeysForBrand(brandId) { return groupRejected(store.suggestions.filter((s) => s.brand_id === brandId && s.status === "rejected")); },
    async upsertScanResults(brandId, results, orphanIds) {
      const plan = planScanUpsert(store.suggestions.filter((s) => s.brand_id === brandId), results, orphanIds);
      const del = new Set(plan.deleteIds), stale = new Set(plan.staleIds);
      store.suggestions = store.suggestions.filter((s) => !del.has(s.id)).map((s) => (stale.has(s.id) ? { ...s, status: "stale", updated_at: now() } : s));
      for (const r of plan.inserts) {
        store.suggestions.push({
          id: `s${++n}`, brand_id: brandId, orphan_page_id: r.orphan_page_id, host_page_id: r.host_page_id ?? null, phrase: r.phrase ?? null, context: r.context ?? null,
          status: r.status ?? "pending", reason: r.reason ?? null, phrases_tried: r.phrases_tried ?? [], href: null, undo_snippet: null, applied_at: null, applied_by: null, created_at: now(), updated_at: now(),
        });
      }
      return { created: plan.created, staled: plan.staled, removed: plan.removed };
    },
    async setStatus(id, patch) {
      const i = store.suggestions.findIndex((s) => s.id === id);
      if (i >= 0) store.suggestions[i] = { ...store.suggestions[i], ...patch, updated_at: now() };
    },
    async logScan(brandId, detail, rows, userId) { store.imports.push({ brand_id: brandId, kind: "link_scan", detail, rows, created_by: userId, created_at: now() }); },
    async lastScan(brandId) {
      const scans = store.imports.filter((i) => i.brand_id === brandId && i.kind === "link_scan");
      return scans.length ? scans[scans.length - 1].created_at : null;
    },
    async counts(brandId) {
      const inBrand = <T extends { brand_id: string }>(xs: T[]) => (brandId ? xs.filter((x) => x.brand_id === brandId) : xs);
      return { pages: inBrand(store.pages).length, pending: inBrand(store.suggestions).filter((s) => s.status === "pending").length, added: inBrand(store.suggestions).filter((s) => s.status === "approved").length };
    },
  };
  return store;
}
