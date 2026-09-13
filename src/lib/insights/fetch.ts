import { graphFetch } from "@/lib/meta/graph";

export type Insights = { likes: number; comments: number; shares?: number; reach?: number; saved?: number; fetched_at: string };

type FbPost = {
  likes?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  shares?: { count?: number };
  insights?: { data?: { name: string; values?: { value?: number }[] }[] };
};

export async function fetchFacebookInsights(postId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<Insights> {
  let r: FbPost;
  try {
    r = await graphFetch<FbPost>(`/${postId}`, { token, params: { fields: "likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions_unique)" }, fetchImpl });
  } catch {
    // insights edge can be forbidden without read_insights; fall back to engagement only
    r = await graphFetch<FbPost>(`/${postId}`, { token, params: { fields: "likes.summary(true),comments.summary(true),shares" }, fetchImpl });
  }
  const reach = r.insights?.data?.find((d) => d.name === "post_impressions_unique")?.values?.[0]?.value;
  return { likes: r.likes?.summary?.total_count ?? 0, comments: r.comments?.summary?.total_count ?? 0, shares: r.shares?.count ?? 0, reach, fetched_at: new Date().toISOString() };
}

export async function fetchInstagramInsights(mediaId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<Insights> {
  const base = await graphFetch<{ like_count?: number; comments_count?: number }>(`/${mediaId}`, { token, params: { fields: "like_count,comments_count" }, fetchImpl });
  let reach: number | undefined;
  let saved: number | undefined;
  try {
    const ins = await graphFetch<{ data?: { name: string; values?: { value?: number }[] }[] }>(`/${mediaId}/insights`, { token, params: { metric: "reach,saved" }, fetchImpl });
    reach = ins.data?.find((d) => d.name === "reach")?.values?.[0]?.value;
    saved = ins.data?.find((d) => d.name === "saved")?.values?.[0]?.value;
  } catch {}
  return { likes: base.like_count ?? 0, comments: base.comments_count ?? 0, reach, saved, fetched_at: new Date().toISOString() };
}
