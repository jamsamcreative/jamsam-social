import { createHash } from "node:crypto";

export const MEDIA_EXT = /\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|mov|mp3|docx?|xlsx?)$/i;

const ENTITIES: [RegExp, string][] = [
  [/&amp;/g, "&"], [/&lt;/g, "<"], [/&gt;/g, ">"], [/&quot;/g, '"'], [/&#0?39;|&apos;|&#8217;|&rsquo;|&#8216;|&lsquo;/g, "'"],
  [/&#8211;|&ndash;|&#8212;|&mdash;/g, "-"], [/&#8230;|&hellip;/g, "…"], [/&nbsp;|&#160;/g, " "], [/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"'],
];
export function decodeEntities(s: string): string {
  let out = s;
  for (const [re, rep] of ENTITIES) out = out.replace(re, rep);
  return out.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Body HTML → plain text. Block-level tags become spaces so sentences don't run together. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote|section|article|figure|figcaption|table|tr|td|th|br|hr)>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\s+/g, " ").trim();
}

export function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/**
 * Canonical https://host/path for an internal link; null when it is not a page on this site.
 * `siteOrigins` may list several hosts the site answers on (public domain, hosting subdomain); a link on any of them is
 * internal, and the output is always written on the first.
 */
export function normaliseUrl(href: string, siteOrigins: string | string[]): string | null {
  const origins = (Array.isArray(siteOrigins) ? siteOrigins : [siteOrigins]).filter(Boolean);
  if (!origins.length) return null;
  const h = href.trim();
  if (!h || /^(mailto:|tel:|javascript:|#)/i.test(h)) return null;
  let u: URL;
  try {
    u = new URL(h.startsWith("//") ? `https:${h}` : h, origins[0]);
  } catch { return null; }
  const host = (x: string) => x.replace(/^www\./, "").toLowerCase();
  const canonical = host(new URL(origins[0]).hostname);
  if (!origins.some((o) => host(u.hostname) === host(new URL(o).hostname))) return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (MEDIA_EXT.test(path) || /^\/wp-content\//.test(path)) return null;
  return `https://${canonical}${path}`;
}

export function extractInternalLinks(html: string, siteOrigins: string | string[]): { href: string; anchorText: string }[] {
  const out: { href: string; anchorText: string }[] = [];
  const re = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = normaliseUrl(m[1] ?? m[2] ?? "", siteOrigins);
    if (href) out.push({ href, anchorText: htmlToText(m[3]) });
  }
  return out;
}
