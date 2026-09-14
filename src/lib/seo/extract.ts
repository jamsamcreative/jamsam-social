import type { ProjectInput } from "./csv";

const US_STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";

/** URLs from a sitemap (or sitemap index → child sitemaps are returned as `{ index: true }`) filtered to one host + prefix. */
export function filterSitemapUrls(xml: string, prefix: string, host: string, max = 500): { urls: string[]; childSitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
  const isIndex = /<sitemapindex/i.test(xml);
  if (isIndex) return { urls: [], childSitemaps: locs };
  const urls = locs.filter((u) => {
    try {
      const x = new URL(u);
      return x.hostname.replace(/^www\./, "") === host.replace(/^www\./, "") && (x.pathname.startsWith(prefix) || u.startsWith(prefix));
    } catch {
      return false;
    }
  });
  return { urls: [...new Set(urls)].slice(0, max), childSitemaps: [] };
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const meta = (html: string, key: string) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i")) ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i"));
  return m ? decode(m[1]) : undefined;
};

/** Best-effort project facts from one HTML page: title, description, images, dims, state, JSON-LD when present. */
export function extractProjectFromHtml(html: string, url: string): ProjectInput {
  const title = meta(html, "og:title") ?? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "") ?? url;
  const description = meta(html, "og:description") ?? meta(html, "description");
  const body = html.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i)?.[1] ?? html;
  const og = meta(html, "og:image");
  const imgs = [...body.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)].map((m) => ({ url: new URL(m[1], url).toString(), alt: decode(m[0].match(/alt=["']([^"']*)["']/i)?.[1] ?? "") || undefined }));
  const images = [...(og ? [{ url: og }] : []), ...imgs].filter((x, i, a) => /^https?:\/\//.test(x.url) && !/logo|icon|avatar|\.svg($|\?)/i.test(x.url) && a.findIndex((y) => y.url === x.url) === i).slice(0, 8);
  const text = decode(body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "));
  const dims = (title + " " + text).match(/\b(\d{2,3})\s?[x×]\s?(\d{2,3})\b/i);
  const state = (title + " " + (description ?? "")).match(new RegExp(`\\b(${US_STATES})\\b`))?.[1];
  const location = (title + " " + (description ?? "")).match(new RegExp(`\\b([A-Z][a-z]+(?: [A-Z][a-z]+)?),\\s?(${US_STATES})\\b`));
  let category: string | undefined;
  let external_id: string | undefined;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]) as Record<string, unknown> | Record<string, unknown>[];
      for (const node of Array.isArray(j) ? j : [j]) {
        if (typeof node.category === "string") category ??= node.category;
        if (typeof node.sku === "string") external_id ??= node.sku;
      }
    } catch {}
  }
  const job = text.match(/\bjob\s*(?:#|number|no\.?)?\s*:?\s*(\d{3,7})\b/i)?.[1];
  return { title, url, description, images, tags: [], dims: dims ? `${dims[1]}x${dims[2]}` : undefined, state, location: location ? `${location[1]}, ${location[2]}` : undefined, category, external_id: external_id ?? job };
}
