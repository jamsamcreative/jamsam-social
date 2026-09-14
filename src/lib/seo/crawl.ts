import { filterSitemapUrls, extractProjectFromHtml } from "./extract";
import type { ProjectInput } from "./csv";

export type CrawlDeps = { fetchImpl?: typeof fetch; concurrency?: number; maxUrls?: number; onProgress?: (done: number, total: number) => Promise<void> | void };

async function text(url: string, fetchImpl: typeof fetch): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { "User-Agent": "JamSamSocial/1.0 (+https://jamsam-social.vercel.app)" } });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/** Resolves all project URLs under `prefix` from the site's sitemap (following one level of index). */
export async function discoverUrls(siteUrl: string, prefix: string, deps: CrawlDeps = {}): Promise<string[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const host = new URL(siteUrl).hostname;
  const max = deps.maxUrls ?? 500;
  const seen = new Set<string>();
  const candidates = [new URL("/sitemap.xml", siteUrl).toString(), new URL("/sitemap_index.xml", siteUrl).toString(), new URL("/wp-sitemap.xml", siteUrl).toString()];
  for (const sm of candidates) {
    let xml: string;
    try {
      xml = await text(sm, fetchImpl);
    } catch {
      continue;
    }
    const { urls, childSitemaps } = filterSitemapUrls(xml, prefix, host, max);
    urls.forEach((u) => seen.add(u));
    for (const child of childSitemaps.slice(0, 50)) {
      if (seen.size >= max) break;
      try {
        const r = filterSitemapUrls(await text(child, fetchImpl), prefix, host, max);
        r.urls.forEach((u) => seen.add(u));
      } catch {}
    }
    if (seen.size > 0) break;
  }
  return [...seen].slice(0, max);
}

/** Fetches each URL with bounded concurrency and extracts project facts; failures are skipped and counted. */
export async function crawlProjects(urls: string[], deps: CrawlDeps = {}): Promise<{ projects: ProjectInput[]; failed: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const conc = deps.concurrency ?? 4;
  const projects: ProjectInput[] = [];
  let failed = 0, done = 0, next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        projects.push(extractProjectFromHtml(await text(url, fetchImpl), url));
      } catch {
        failed++;
      }
      done++;
      await deps.onProgress?.(done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, urls.length) }, worker));
  return { projects, failed };
}
