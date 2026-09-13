"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import type { WordpressConfig, WordpressSecret } from "@/lib/connections/wordpress-shared";
import { createWpClient, checkHelper, uploadMediaFromUrl, createPost, updatePost, getPost } from "@/lib/wordpress/client";
import { getWpTerms } from "@/lib/wordpress/terms";
import { zonedLocalToUtc } from "@/lib/time/zoned";
import type { Json, MediaItem } from "@/lib/database.types";
import { parseArticleForm } from "./schema";
import { buildPostPayload, buildPublishPayload, metaDescriptionWarning, rehostImages, validateForPush, type ArticleLike } from "./push";
import type { ArticleWithBrand } from "./queries";

export type ActionResult = { ok: true; id?: string; warnings?: string[] } | { ok: false; error: string };

type Loaded = { error: string; article?: undefined; userId?: undefined } | { error?: undefined; article: ArticleWithBrand; userId: string };

async function load(id: string): Promise<Loaded> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { data } = await supabase.from("articles").select("*, brand:brands(slug,name,timezone,seo_suffix,website_url)").eq("id", id).maybeSingle();
  if (!data) return { error: "Article not found" };
  return { article: data as unknown as ArticleWithBrand, userId: user.id };
}

function refresh(id?: string) {
  revalidatePath("/articles");
  if (id) revalidatePath(`/articles/${id}`);
  revalidatePath("/dashboard");
}

export async function saveArticle(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = parseArticleForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid article" };
  const a = parsed.data;
  const row = {
    brand_id: a.brand_id,
    title: a.title,
    slug: a.slug,
    content_html: a.content_html,
    excerpt: a.excerpt,
    seo_title: a.seo_title,
    meta_description: a.meta_description,
    primary_keyword: a.primary_keyword,
    secondary_keywords: a.secondary_keywords,
    featured_media: a.featured_media as Json,
    categories: a.categories as Json,
    tags: a.tags as Json,
    decision: a.decision,
    rationale: a.rationale,
  };
  let id = a.id;
  if (id) {
    const { error } = await supabase.from("articles").update(row).eq("id", id);
    if (error) return { ok: false, error: error.code === "23505" ? "That slug is already used by another article for this brand" : error.message };
  } else {
    const { data, error } = await supabase.from("articles").insert({ ...row, created_by: user.id }).select("id").single();
    if (error || !data) return { ok: false, error: error?.code === "23505" ? "That slug is already used by another article for this brand" : (error?.message ?? "Could not create article") };
    id = data.id;
  }
  refresh(id);
  return { ok: true, id };
}

function asLike(a: ArticleWithBrand): ArticleLike {
  return {
    title: a.title,
    slug: a.slug,
    content_html: a.content_html,
    excerpt: a.excerpt,
    seo_title: a.seo_title,
    meta_description: a.meta_description,
    primary_keyword: a.primary_keyword,
    featured_media: a.featured_media as MediaItem | null,
    categories: (a.categories as { id: number; name: string }[]) ?? [],
    tags: (a.tags as { id: number; name: string }[]) ?? [],
  };
}

async function wpFor(brandId: string) {
  const conn = await getConnectionWithSecret<WordpressConfig, WordpressSecret>(brandId, "wordpress");
  if (!conn) return null;
  return createWpClient(conn.config, conn.secret);
}

export async function pushArticle(id: string): Promise<ActionResult> {
  const r = await load(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  const a = r.article;
  const like = asLike(a);
  const v = validateForPush(like);
  if (v) return { ok: false, error: v };
  const client = await wpFor(a.brand_id);
  if (!client) return { ok: false, error: "WordPress is not connected for this brand" };
  const admin = createAdminSupabase();
  const warnings: string[] = [];
  const md = metaDescriptionWarning(a.meta_description);
  if (md) warnings.push(md);
  try {
    const helper = await checkHelper(client);
    if (!helper.installed) warnings.push("JamSam helper plugin is not installed on this site, so Yoast fields were not set");
    const rehosted = await rehostImages({
      html: a.content_html,
      featured: like.featured_media,
      siteHost: new URL(client.siteUrl).hostname,
      lookup: async (url) => (await admin.from("article_media_map").select("wp_media_id,wp_url").eq("brand_id", a.brand_id).eq("source_url", url).maybeSingle()).data,
      upload: async (url, alt) => {
        const up = await uploadMediaFromUrl(client, url, { alt });
        await admin.from("article_media_map").upsert({ brand_id: a.brand_id, source_url: url, wp_media_id: up.id, wp_url: up.source_url }, { onConflict: "brand_id,source_url" });
        return up;
      },
    });
    const payload = buildPostPayload(like, { html: rehosted.html, featuredId: rehosted.featuredId, helperInstalled: helper.installed, suffix: a.brand.seo_suffix });
    const res = a.wp_post_id ? await updatePost(client, a.wp_post_id, payload) : await createPost(client, payload);
    await admin
      .from("articles")
      .update({
        wp_post_id: res.id,
        wp_link: res.link,
        wp_status: res.status,
        pushed_at: new Date().toISOString(),
        last_error: null,
        content_html: rehosted.html,
        status: a.status === "published" ? "published" : "pushed_to_wp",
      })
      .eq("id", id);
    refresh(id);
    return { ok: true, warnings };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("articles").update({ last_error: msg }).eq("id", id);
    refresh(id);
    return { ok: false, error: msg };
  }
}

export async function publishArticle(id: string, dateLocal?: string): Promise<ActionResult> {
  const r = await load(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  const a = r.article;
  if (!a.wp_post_id) return { ok: false, error: "Push the article to WordPress first" };
  const client = await wpFor(a.brand_id);
  if (!client) return { ok: false, error: "WordPress is not connected for this brand" };
  const admin = createAdminSupabase();
  try {
    const iso = dateLocal ? zonedLocalToUtc(dateLocal, a.brand.timezone) : undefined;
    const res = await updatePost(client, a.wp_post_id, buildPublishPayload(iso));
    await admin
      .from("articles")
      .update({ wp_status: res.status, wp_link: res.link, published_at: res.date_gmt ? `${res.date_gmt}Z` : new Date().toISOString(), status: "published", last_error: null })
      .eq("id", id);
    refresh(id);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("articles").update({ last_error: msg }).eq("id", id);
    refresh(id);
    return { ok: false, error: msg };
  }
}

export async function syncArticle(id: string): Promise<ActionResult> {
  const r = await load(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  const a = r.article;
  if (!a.wp_post_id) return { ok: false, error: "Not pushed to WordPress yet" };
  const client = await wpFor(a.brand_id);
  if (!client) return { ok: false, error: "WordPress is not connected for this brand" };
  try {
    const res = await getPost(client, a.wp_post_id);
    const admin = createAdminSupabase();
    const isLive = res.status === "publish";
    await admin
      .from("articles")
      .update({
        wp_status: res.status,
        wp_link: res.link,
        last_error: null,
        ...(isLive ? { status: "published" as const, published_at: res.date_gmt ? `${res.date_gmt}Z` : a.published_at } : {}),
      })
      .eq("id", id);
    refresh(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function archiveArticle(id: string): Promise<ActionResult> {
  const r = await load(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  const supabase = await createServerSupabase();
  await supabase.from("articles").update({ status: "archived" }).eq("id", id);
  refresh(id);
  return { ok: true };
}

export async function refreshTerms(brandId: string): Promise<ActionResult> {
  try {
    const t = await getWpTerms(brandId, { refresh: true });
    if (!t) return { ok: false, error: "WordPress is not connected for this brand" };
    revalidatePath("/articles", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
