"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createSupabaseStore } from "@/lib/ai/store";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import type { SemrushConfig, SemrushSecret } from "@/lib/connections/semrush";
import { parseKeywordCsv, parseProjectsCsv, type ProjectInput } from "./csv";
import { normaliseKeyword } from "./score";
import { discoverUrls, crawlProjects } from "./crawl";
import { phraseThese, domainDomains, estimateUnits } from "@/lib/semrush/client";
import { mirrorBrandSite, enrichBrandFromGsc } from "./run";
import { enqueueJob } from "@/lib/jobs/actions";
import type { Json } from "@/lib/database.types";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

async function user() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
async function brandDomain(brandId: string): Promise<string | undefined> {
  const { data } = await createAdminSupabase().from("brands").select("website_url").eq("id", brandId).single();
  try {
    return data?.website_url ? new URL(data.website_url).hostname.replace(/^www\./, "") : undefined;
  } catch {
    return undefined;
  }
}
function refresh() {
  revalidatePath("/seo");
}

export async function importKeywordsCsv(brandId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const u = await user();
  if (!u) return { ok: false, error: "Not signed in" };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a CSV file" };
  try {
    const parsed = parseKeywordCsv(await file.text(), { brandDomain: await brandDomain(brandId) });
    const store = createSupabaseStore();
    const n = await store.upsertKeywords(brandId, parsed.rows.map((r) => ({ ...r, source: "csv" as const })));
    await store.logImport(brandId, "keywords_csv", file.name, n, u.id);
    refresh();
    return { ok: true, message: `Imported ${n} keyword${n === 1 ? "" : "s"} (${parsed.layout === "keyword_gap" ? "SEMrush Keyword Gap layout" : "generic layout"}${parsed.skipped ? `, ${parsed.skipped} skipped` : ""})` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function upsertProjects(brandId: string, rows: ProjectInput[]): Promise<number> {
  const admin = createAdminSupabase();
  let n = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200).map((p) => ({ brand_id: brandId, external_id: p.external_id ?? null, title: p.title, url: p.url ?? null, category: p.category ?? null, location: p.location ?? null, state: p.state ?? null, dims: p.dims ?? null, description: p.description ?? null, images: p.images as unknown as Json, tags: p.tags }));
    const withUrl = batch.filter((b) => b.url);
    const withoutUrl = batch.filter((b) => !b.url);
    if (withUrl.length) {
      const { error } = await admin.from("projects").upsert(withUrl, { onConflict: "brand_id,url" });
      if (error) throw new Error(error.message);
      n += withUrl.length;
    }
    if (withoutUrl.length) {
      const { error } = await admin.from("projects").insert(withoutUrl);
      if (error) throw new Error(error.message);
      n += withoutUrl.length;
    }
  }
  return n;
}

export async function importProjectsCsv(brandId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const u = await user();
  if (!u) return { ok: false, error: "Not signed in" };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a CSV file" };
  try {
    const parsed = parseProjectsCsv(await file.text());
    const n = await upsertProjects(brandId, parsed.rows);
    await createSupabaseStore().logImport(brandId, "projects_csv", file.name, n, u.id);
    refresh();
    return { ok: true, message: `Imported ${n} project${n === 1 ? "" : "s"}${parsed.skipped ? `, ${parsed.skipped} skipped` : ""}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Sitemap crawl runs after the response; progress is written to the import log row count. */
export async function startCrawl(brandId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const u = await user();
  if (!u) return { ok: false, error: "Not signed in" };
  const siteUrl = String(formData.get("site_url") ?? "").trim();
  const prefix = String(formData.get("prefix") ?? "").trim() || "/";
  try {
    new URL(siteUrl);
  } catch {
    return { ok: false, error: "Enter the site URL, e.g. https://client.com" };
  }
  const admin = createAdminSupabase();
  const { data: log } = await admin.from("keyword_imports").insert({ brand_id: brandId, kind: "sitemap_crawl", detail: `${siteUrl}${prefix} (starting…)`, rows: 0, created_by: u.id }).select("id").single();
  after(async () => {
    try {
      const urls = await discoverUrls(siteUrl, prefix);
      if (urls.length === 0) {
        await admin.from("keyword_imports").update({ detail: `${siteUrl}${prefix} — no URLs found in the sitemap under that prefix` }).eq("id", log!.id);
        return;
      }
      const { projects, failed } = await crawlProjects(urls, { onProgress: async (done, total) => { if (done % 10 === 0 || done === total) await admin.from("keyword_imports").update({ rows: done, detail: `${siteUrl}${prefix} — ${done}/${total} pages` }).eq("id", log!.id); } });
      const n = await upsertProjects(brandId, projects);
      await admin.from("keyword_imports").update({ rows: n, detail: `${siteUrl}${prefix} — ${n} projects${failed ? `, ${failed} pages failed` : ""}` }).eq("id", log!.id);
    } catch (e) {
      await admin.from("keyword_imports").update({ detail: `${siteUrl}${prefix} — failed: ${e instanceof Error ? e.message : String(e)}` }).eq("id", log!.id);
    }
  });
  refresh();
  return { ok: true, message: "Crawl started — refresh the Imports tab to watch progress" };
}

export async function semrushEstimate(brandId: string): Promise<ActionResult<{ units: number; keywords: number; gapRows: number; competitors: string[] }>> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  const conn = await getConnectionWithSecret<SemrushConfig, SemrushSecret>(brandId, "semrush");
  if (!conn) return { ok: false, error: "Connect SEMrush on the brand first" };
  const keywords = (await createSupabaseStore().listKeywords(brandId)).length;
  const gapRows = conn.config.competitors?.length ? 500 : 0;
  return { ok: true, data: { units: estimateUnits({ keywords, gapRows }), keywords, gapRows, competitors: conn.config.competitors ?? [] } };
}

export async function refreshSemrush(brandId: string): Promise<ActionResult> {
  const u = await user();
  if (!u) return { ok: false, error: "Not signed in" };
  const conn = await getConnectionWithSecret<SemrushConfig, SemrushSecret>(brandId, "semrush");
  if (!conn) return { ok: false, error: "Connect SEMrush on the brand first" };
  const store = createSupabaseStore();
  const domain = await brandDomain(brandId);
  try {
    const existing = await store.listKeywords(brandId);
    let n = 0;
    if (existing.length) {
      const fresh = await phraseThese(conn.secret.api_key, conn.config.database, existing.map((k) => k.keyword));
      n += await store.upsertKeywords(brandId, fresh.map((k) => ({ ...k, source: "semrush" as const })));
    }
    if (domain && conn.config.competitors?.length) {
      const gap = await domainDomains(conn.secret.api_key, conn.config.database, domain, conn.config.competitors, 500);
      const rows = gap.map((k) => ({ ...k, keyword: normaliseKeyword(k.keyword), source: "semrush" as const }));
      n += await store.upsertKeywords(brandId, rows);
    }
    await store.logImport(brandId, "semrush_refresh", `${domain ?? "?"} vs ${(conn.config.competitors ?? []).join(", ") || "(no competitors)"}`, n, u.id);
    refresh();
    return { ok: true, message: `SEMrush refresh updated ${n} keyword rows` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function refreshGsc(brandId: string): Promise<ActionResult> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  const r = await enrichBrandFromGsc(brandId);
  refresh();
  return { ok: true, message: `Search Console enrichment updated ${r.updated} keyword${r.updated === 1 ? "" : "s"}` };
}

export async function mirrorSiteNow(brandId: string): Promise<ActionResult> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  const r = await mirrorBrandSite(brandId);
  refresh();
  return "error" in r ? { ok: false, error: r.error } : { ok: true, message: `Mirrored ${r.pages} published page${r.pages === 1 ? "" : "s"}` };
}

export async function setKeywordCluster(brandId: string, keyword: string, cluster: string): Promise<ActionResult> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  await createSupabaseStore().setClusters(brandId, [{ keyword: normaliseKeyword(keyword), cluster: cluster.trim() || null }]);
  refresh();
  return { ok: true };
}

export async function deleteKeyword(brandId: string, keyword: string): Promise<ActionResult> {
  if (!(await user())) return { ok: false, error: "Not signed in" };
  await createAdminSupabase().from("keywords").delete().eq("brand_id", brandId).eq("keyword", normaliseKeyword(keyword));
  refresh();
  return { ok: true };
}

export async function clusterWithAi(brandId: string): Promise<ActionResult> {
  const r = await enqueueJob({ brandId, type: "seo_cluster", input: { limit: 300 } });
  return r.ok ? { ok: true, message: "Clustering job queued — see Jobs" } : { ok: false, error: r.error };
}
