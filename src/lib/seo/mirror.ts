import type { WpClient } from "@/lib/wordpress/client";

export type MirroredPage = { wp_id: number; type: "post" | "page"; slug: string; url: string; title: string; excerpt: string | null; focus_keyword: string | null; featured_image_url: string | null; modified_at: string | null };
type WpItem = { id: number; slug: string; link: string; modified_gmt?: string; title?: { rendered?: string }; excerpt?: { rendered?: string }; meta?: Record<string, unknown>; _embedded?: { "wp:featuredmedia"?: { source_url?: string }[] } };

const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#8217;|&#039;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, "-").replace(/&#8230;|&hellip;/g, "…").replace(/\s+/g, " ").trim();

/** Every published post and page (WP REST, 100 per page). Focus keyword arrives via the helper plugin's registered meta. */
export async function mirrorSite(client: WpClient): Promise<MirroredPage[]> {
  const out: MirroredPage[] = [];
  for (const type of ["post", "page"] as const) {
    for (let page = 1; page <= 50; page++) {
      const { data, headers } = await client.get<WpItem[]>(`/wp/v2/${type}s`, { status: "publish", per_page: "100", page: String(page), _embed: "wp:featuredmedia", _fields: "id,slug,link,modified_gmt,title,excerpt,meta,_links,_embedded" });
      for (const it of data) {
        out.push({
          wp_id: it.id, type, slug: it.slug, url: it.link, title: strip(it.title?.rendered ?? it.slug), excerpt: it.excerpt?.rendered ? strip(it.excerpt.rendered).slice(0, 500) || null : null,
          focus_keyword: typeof it.meta?._yoast_wpseo_focuskw === "string" && it.meta._yoast_wpseo_focuskw ? (it.meta._yoast_wpseo_focuskw as string) : null,
          featured_image_url: it._embedded?.["wp:featuredmedia"]?.[0]?.source_url ?? null, modified_at: it.modified_gmt ? `${it.modified_gmt}Z` : null,
        });
      }
      if (page >= Number(headers.get("X-WP-TotalPages") ?? "1")) break;
    }
  }
  return out;
}
