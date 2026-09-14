import { createServerSupabase } from "@/lib/supabase/server";
import { median } from "@/lib/metrics/aggregate";
import type { Window } from "@/lib/metrics/ranges";

export type ContentSocialVM = {
  published: { facebook: number; instagram: number };
  medianEngagement: { facebook: number | null; instagram: number | null };
  fbWithheld: boolean;
  topPosts: { id: string; title: string; platform: string; engagement: number; url: string | null; published_at: string }[];
  articlesPublished: { id: string; title: string; published_at: string; wp_link: string | null }[];
  excludedRecent: number;
  pins: { published: number; medianImpressions: number | null; top: { id: string; title: string; impressions: number; saves: number; url: string | null; published_at: string }[] };
};

type PinIns = { impressions?: number; saves?: number } | null;

type Ins = { likes?: number; comments?: number; shares?: number; saved?: number; reach?: number } | null;
const engagementOf = (i: Ins) => (i ? (i.likes ?? 0) + (i.comments ?? 0) + (i.shares ?? 0) + (i.saved ?? 0) : null);

/** Organic social + articles for the window, from Phase 2/3 tables. Posts < 72h old are excluded from medians. */
export async function loadContentSocial(brandId: string, w: Window, now = new Date()): Promise<ContentSocialVM> {
  const supabase = await createServerSupabase();
  const [{ data: targets }, { data: articles }, { data: pinRows }] = await Promise.all([
    supabase
      .from("post_targets")
      .select("id,platform,published_at,external_url,insights, post:posts!inner(id,title,brand_id)")
      .eq("status", "published")
      .eq("post.brand_id", brandId)
      .gte("published_at", `${w.start}T00:00:00Z`)
      .lte("published_at", `${w.end}T23:59:59Z`),
    supabase.from("articles").select("id,title,published_at,wp_link").eq("brand_id", brandId).gte("published_at", `${w.start}T00:00:00Z`).lte("published_at", `${w.end}T23:59:59Z`).order("published_at", { ascending: false }),
    supabase.from("pins").select("id,title,published_at,external_url,insights").eq("brand_id", brandId).eq("status", "published").gte("published_at", `${w.start}T00:00:00Z`).lte("published_at", `${w.end}T23:59:59Z`),
  ]);
  const pinsAll = (pinRows ?? []).filter((p) => p.published_at);
  const pinImp = pinsAll.map((p) => (p.insights as PinIns)?.impressions).filter((n): n is number => typeof n === "number");
  type T = { id: string; platform: "facebook" | "instagram"; published_at: string | null; external_url: string | null; insights: Ins; post: { id: string; title: string } };
  const rows = ((targets ?? []) as unknown as T[]).filter((t) => t.published_at);
  const cutoff = now.getTime() - 72 * 3600_000;
  const measurable = rows.filter((t) => Date.parse(t.published_at!) < cutoff);
  const eng = (p: "facebook" | "instagram") => measurable.filter((t) => t.platform === p).map((t) => engagementOf(t.insights)).filter((n): n is number => n !== null);
  const fbAll = measurable.filter((t) => t.platform === "facebook");
  return {
    published: { facebook: rows.filter((t) => t.platform === "facebook").length, instagram: rows.filter((t) => t.platform === "instagram").length },
    medianEngagement: { facebook: median(eng("facebook")), instagram: median(eng("instagram")) },
    fbWithheld: fbAll.length > 0 && eng("facebook").length === 0,
    topPosts: measurable
      .map((t) => ({ id: t.post.id, title: t.post.title, platform: t.platform, engagement: engagementOf(t.insights) ?? 0, url: t.external_url, published_at: t.published_at! }))
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, 10),
    articlesPublished: (articles ?? []).map((a) => ({ id: a.id, title: a.title, published_at: a.published_at!, wp_link: a.wp_link })),
    excludedRecent: rows.length - measurable.length,
    pins: {
      published: pinsAll.length,
      medianImpressions: median(pinImp),
      top: pinsAll
        .map((p) => ({ id: p.id, title: p.title, impressions: (p.insights as PinIns)?.impressions ?? 0, saves: (p.insights as PinIns)?.saves ?? 0, url: p.external_url, published_at: p.published_at! }))
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 10),
    },
  };
}
