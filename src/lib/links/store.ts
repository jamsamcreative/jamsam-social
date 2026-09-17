import { createAdminSupabase } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";
import type { LinkEdge, NoneVerdict, PageLite, Suggestion } from "./types";

export type LinkSuggestionRow = Database["public"]["Tables"]["link_suggestions"]["Row"];
export type LinkSuggestionStatus = LinkSuggestionRow["status"];
export type LinkSuggestionInsert = Database["public"]["Tables"]["link_suggestions"]["Insert"];
export type PageWithHtml = PageLite & { content_html: string };

export interface LinksStore {
  getBrand(brandId: string): Promise<{ id: string; slug: string; name: string; website_url: string | null } | null>;
  listActiveBrands(): Promise<{ id: string; slug: string; name: string }[]>;
  /** From site_pages; `content_text` is '' when the column is null (page mirrored before Phase 8). */
  listPages(brandId: string): Promise<PageLite[]>;
  getPage(pageId: string): Promise<(PageLite & { wp_id: number }) | null>;
  replaceEdges(brandId: string, edges: LinkEdge[]): Promise<void>;
  addEdge(brandId: string, edge: LinkEdge): Promise<void>;
  removeEdge(brandId: string, fromId: string, toId: string, href: string): Promise<void>;
  listEdges(brandId: string): Promise<LinkEdge[]>;
  listSuggestions(brandId: string, statuses?: LinkSuggestionStatus[]): Promise<LinkSuggestionRow[]>;
  getSuggestion(id: string): Promise<LinkSuggestionRow | null>;
  /** `${host}|${phrase}` for every rejected row of this orphan — never re-proposed. */
  rejectedKeys(brandId: string, orphanId: string): Promise<Set<string>>;
  /** See `planScanUpsert` for the exact keep / stale / remove rules. */
  upsertScanResults(brandId: string, results: (Suggestion | NoneVerdict)[], orphanIds: string[]): Promise<{ created: number; staled: number; removed: number }>;
  setStatus(id: string, patch: Partial<Pick<LinkSuggestionRow, "status" | "href" | "undo_snippet" | "applied_at" | "applied_by">>): Promise<void>;
  /** One `keyword_imports` row of kind `link_scan`; feeds "Site last scanned". */
  logScan(brandId: string, detail: string, rows: number, userId: string | null): Promise<void>;
  lastScan(brandId: string): Promise<string | null>;
  counts(brandId?: string): Promise<{ pages: number; pending: number; added: number }>;
}

export const isSuggestion = (r: Suggestion | NoneVerdict): r is Suggestion => "host_page_id" in r;

export type ScanPlan = { keepIds: string[]; staleIds: string[]; deleteIds: string[]; inserts: Omit<LinkSuggestionInsert, "brand_id">[]; created: number; staled: number; removed: number };

/**
 * Pure reconciliation of a scan against the brand's current `pending`/`none` rows (approved/rejected/undone/stale are history and untouched):
 * - orphan no longer in `orphanIds` → its pending/none rows are deleted (`removed`);
 * - a pending row with the same host+phrase as the new suggestion for that orphan is kept as-is (no new row);
 * - any other pending row for a still-orphan page → `stale` (`staled`) — its host/phrase changed or it now has a `none` verdict;
 * - a `none` row for a still-orphan page is replaced by the new outcome;
 * - every result for a listed orphan without a kept twin is inserted as a fresh pending/none row (`created`); results for pages not in `orphanIds` are ignored.
 */
export function planScanUpsert(existing: Pick<LinkSuggestionRow, "id" | "orphan_page_id" | "host_page_id" | "phrase" | "status">[], results: (Suggestion | NoneVerdict)[], orphanIds: string[]): ScanPlan {
  const orphans = new Set(orphanIds);
  const byOrphan = new Map<string, Suggestion | NoneVerdict>();
  for (const r of results) if (orphans.has(r.orphan_page_id)) byOrphan.set(r.orphan_page_id, r); // results for non-orphans are ignored
  const plan: ScanPlan = { keepIds: [], staleIds: [], deleteIds: [], inserts: [], created: 0, staled: 0, removed: 0 };
  const kept = new Set<string>();
  for (const row of existing) {
    if (row.status !== "pending" && row.status !== "none") continue;
    if (!orphans.has(row.orphan_page_id)) { plan.deleteIds.push(row.id); plan.removed++; continue; }
    const next = byOrphan.get(row.orphan_page_id);
    if (row.status === "pending") {
      if (next && isSuggestion(next) && next.host_page_id === row.host_page_id && next.phrase === row.phrase && !kept.has(row.orphan_page_id)) { plan.keepIds.push(row.id); kept.add(row.orphan_page_id); }
      else { plan.staleIds.push(row.id); plan.staled++; }
    } else plan.deleteIds.push(row.id);
  }
  for (const r of byOrphan.values()) { // one outcome per orphan — the partial unique index allows a single pending row
    if (kept.has(r.orphan_page_id)) continue;
    plan.inserts.push(isSuggestion(r)
      ? { orphan_page_id: r.orphan_page_id, host_page_id: r.host_page_id, phrase: r.phrase, context: r.context, status: "pending" }
      : { orphan_page_id: r.orphan_page_id, host_page_id: null, phrase: null, context: null, status: "none", reason: r.reason, phrases_tried: r.phrases_tried });
    plan.created++;
  }
  return plan;
}

const fail = (e: { message: string }): never => { throw new Error(e.message); };
const PAGE_COLS = "id,wp_id,type,slug,url,title,focus_keyword,content_text,modified_at";
type PageRow = { id: string; wp_id: number; type: string; slug: string; url: string; title: string; focus_keyword: string | null; content_text: string | null; modified_at: string | null };
const toPage = (p: PageRow): PageLite & { wp_id: number } => ({ id: p.id, wp_id: p.wp_id, type: p.type === "page" ? "page" : "post", slug: p.slug, url: p.url, title: p.title, focus_keyword: p.focus_keyword, content_text: p.content_text ?? "", modified_at: p.modified_at });

export function createSupabaseLinksStore(): LinksStore {
  const admin = createAdminSupabase();
  return {
    async getBrand(brandId) {
      const { data, error } = await admin.from("brands").select("id,slug,name,website_url").eq("id", brandId).maybeSingle();
      if (error) fail(error);
      return data ?? null;
    },
    async listActiveBrands() {
      const { data, error } = await admin.from("brands").select("id,slug,name").eq("active", true).order("name");
      if (error) fail(error);
      return data ?? [];
    },
    async listPages(brandId) {
      const { data, error } = await admin.from("site_pages").select(PAGE_COLS).eq("brand_id", brandId).limit(5000);
      if (error) fail(error);
      return (data ?? []).map(toPage);
    },
    async getPage(pageId) {
      const { data, error } = await admin.from("site_pages").select(PAGE_COLS).eq("id", pageId).maybeSingle();
      if (error) fail(error);
      return data ? toPage(data) : null;
    },
    async replaceEdges(brandId, edges) {
      const { error: de } = await admin.from("site_links").delete().eq("brand_id", brandId);
      if (de) fail(de);
      const now = new Date().toISOString();
      for (let i = 0; i < edges.length; i += 500) {
        const { error } = await admin.from("site_links").insert(edges.slice(i, i + 500).map((e) => ({ brand_id: brandId, ...e, scanned_at: now })));
        if (error) fail(error);
      }
    },
    async addEdge(brandId, edge) {
      const { error } = await admin.from("site_links").insert({ brand_id: brandId, ...edge });
      if (error) fail(error);
    },
    async removeEdge(brandId, fromId, toId, href) {
      const { error } = await admin.from("site_links").delete().eq("brand_id", brandId).eq("from_page_id", fromId).eq("to_page_id", toId).eq("href", href);
      if (error) fail(error);
    },
    async listEdges(brandId) {
      const { data, error } = await admin.from("site_links").select("from_page_id,to_page_id,href,anchor_text").eq("brand_id", brandId).limit(50000);
      if (error) fail(error);
      return data ?? [];
    },
    async listSuggestions(brandId, statuses) {
      let q = admin.from("link_suggestions").select("*").eq("brand_id", brandId);
      if (statuses?.length) q = q.in("status", statuses);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(5000);
      if (error) fail(error);
      return data ?? [];
    },
    async getSuggestion(id) {
      const { data, error } = await admin.from("link_suggestions").select("*").eq("id", id).maybeSingle();
      if (error) fail(error);
      return data ?? null;
    },
    async rejectedKeys(brandId, orphanId) {
      const { data, error } = await admin.from("link_suggestions").select("host_page_id,phrase").eq("brand_id", brandId).eq("orphan_page_id", orphanId).eq("status", "rejected");
      if (error) fail(error);
      return new Set((data ?? []).filter((r) => r.host_page_id && r.phrase).map((r) => `${r.host_page_id}|${r.phrase}`));
    },
    async upsertScanResults(brandId, results, orphanIds) {
      const { data, error } = await admin.from("link_suggestions").select("id,orphan_page_id,host_page_id,phrase,status").eq("brand_id", brandId).in("status", ["pending", "none"]);
      if (error) fail(error);
      const plan = planScanUpsert(data ?? [], results, orphanIds);
      if (plan.deleteIds.length) {
        const { error: e } = await admin.from("link_suggestions").delete().in("id", plan.deleteIds);
        if (e) fail(e);
      }
      if (plan.staleIds.length) {
        const { error: e } = await admin.from("link_suggestions").update({ status: "stale" }).in("id", plan.staleIds);
        if (e) fail(e);
      }
      for (let i = 0; i < plan.inserts.length; i += 500) {
        const { error: e } = await admin.from("link_suggestions").insert(plan.inserts.slice(i, i + 500).map((r) => ({ brand_id: brandId, ...r })));
        if (e) fail(e);
      }
      return { created: plan.created, staled: plan.staled, removed: plan.removed };
    },
    async setStatus(id, patch) {
      const { error } = await admin.from("link_suggestions").update(patch).eq("id", id);
      if (error) fail(error);
    },
    async logScan(brandId, detail, rows, userId) {
      const { error } = await admin.from("keyword_imports").insert({ brand_id: brandId, kind: "link_scan", detail, rows, created_by: userId });
      if (error) fail(error);
    },
    async lastScan(brandId) {
      const { data, error } = await admin.from("keyword_imports").select("created_at").eq("brand_id", brandId).eq("kind", "link_scan").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) fail(error);
      return data?.created_at ?? null;
    },
    async counts(brandId) {
      const scoped = <Q extends { eq(col: string, v: string): Q }>(q: Q) => (brandId ? q.eq("brand_id", brandId) : q);
      const [pages, pending, added] = await Promise.all([
        scoped(admin.from("site_pages").select("id", { count: "exact", head: true })),
        scoped(admin.from("link_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending")),
        scoped(admin.from("link_suggestions").select("id", { count: "exact", head: true }).eq("status", "approved")),
      ]);
      return { pages: pages.count ?? 0, pending: pending.count ?? 0, added: added.count ?? 0 };
    },
  };
}
