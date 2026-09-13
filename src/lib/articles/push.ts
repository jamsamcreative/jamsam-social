import type { WpPostPayload } from "@/lib/wordpress/client";
import type { MediaItem, TermRef } from "@/lib/database.types";

export type ArticleLike = {
  title: string;
  slug: string;
  content_html: string;
  excerpt: string | null;
  seo_title: string | null;
  meta_description: string | null;
  primary_keyword: string | null;
  featured_media: MediaItem | null;
  categories: TermRef[];
  tags: TermRef[];
};

export function finalSeoTitle(seoTitle: string | null, title: string, suffix: string | null): string {
  const base = (seoTitle?.trim() || title).trim();
  if (!suffix) return base;
  return base.endsWith(suffix.trim()) || base.endsWith(suffix) ? base : `${base}${suffix}`;
}

export function metaDescriptionWarning(desc: string | null): string | null {
  const n = desc?.trim().length ?? 0;
  if (n === 0) return "No meta description set";
  if (n < 120) return `Meta description is ${n} chars; aim for 120 to 156`;
  if (n > 156) return `Meta description is ${n} chars; aim for 120 to 156`;
  return null;
}

export function validateForPush(a: ArticleLike): string | null {
  if (!a.title.trim()) return "Title is required";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug)) return "Slug may only contain lowercase letters, numbers, and hyphens";
  if (!a.content_html.trim()) return "Article content is empty";
  if (!a.featured_media?.url) return "A featured image is required";
  return null;
}

const IMG_RE = /<img\b[^>]*>/gi;
const attr = (tag: string, name: string) =>
  tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? tag.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, "i"))?.[1] ?? null;

export function extractImageUrls(html: string): string[] {
  return [...new Set((html.match(IMG_RE) ?? []).map((t) => attr(t, "src")).filter((s): s is string => Boolean(s)))];
}

export function rewriteImageUrls(html: string, map: Record<string, string>): string {
  return html.replace(IMG_RE, (tag) => {
    const src = attr(tag, "src");
    if (!src || !map[src]) return tag;
    return tag.replace(src, map[src]);
  });
}

function imageAlts(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of html.match(IMG_RE) ?? []) {
    const src = attr(tag, "src");
    if (src) out[src] = attr(tag, "alt") ?? "";
  }
  return out;
}

export async function rehostImages(opts: {
  html: string;
  featured: MediaItem | null;
  siteHost: string;
  lookup: (url: string) => Promise<{ wp_media_id: number; wp_url: string } | null>;
  upload: (url: string, alt: string) => Promise<{ id: number; source_url: string }>;
}): Promise<{ html: string; featuredId: number | null; uploaded: number }> {
  const isExternal = (u: string) => {
    try {
      return new URL(u).hostname !== opts.siteHost;
    } catch {
      return false;
    }
  };
  const alts = imageAlts(opts.html);
  const seen = new Map<string, { id: number; url: string }>();
  const map: Record<string, string> = {};
  let uploaded = 0;
  async function resolve(url: string, alt: string): Promise<{ id: number; url: string } | null> {
    if (!isExternal(url)) return null;
    if (seen.has(url)) return seen.get(url)!;
    const cached = await opts.lookup(url);
    let r: { id: number; url: string };
    if (cached) r = { id: cached.wp_media_id, url: cached.wp_url };
    else {
      const up = await opts.upload(url, alt);
      uploaded++;
      r = { id: up.id, url: up.source_url };
    }
    seen.set(url, r);
    return r;
  }
  for (const url of extractImageUrls(opts.html)) {
    const r = await resolve(url, alts[url] ?? "");
    if (r) map[url] = r.url;
  }
  let featuredId: number | null = null;
  if (opts.featured?.url) {
    const r = await resolve(opts.featured.url, opts.featured.alt ?? "");
    featuredId = r?.id ?? null;
  }
  return { html: rewriteImageUrls(opts.html, map), featuredId, uploaded };
}

export function buildPostPayload(a: ArticleLike, o: { html: string; featuredId: number | null; helperInstalled: boolean; suffix: string | null }): WpPostPayload {
  const p: WpPostPayload = {
    title: a.title,
    slug: a.slug,
    content: o.html,
    excerpt: a.excerpt ?? undefined,
    status: "draft",
    categories: a.categories.map((c) => c.id),
    tags: a.tags.map((t) => t.id),
    featured_media: o.featuredId ?? undefined,
  };
  if (o.helperInstalled) {
    p.meta = {
      _yoast_wpseo_title: finalSeoTitle(a.seo_title, a.title, o.suffix),
      _yoast_wpseo_metadesc: a.meta_description ?? "",
      _yoast_wpseo_focuskw: a.primary_keyword ?? "",
    };
  }
  return p;
}

export function buildPublishPayload(dateIso?: string): Partial<WpPostPayload> {
  if (!dateIso) return { status: "publish" };
  return { status: "future", date_gmt: dateIso.replace(/\.\d{3}Z$/, "").replace(/Z$/, "") };
}
