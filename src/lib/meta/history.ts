import { graphFetch, GraphError } from "./graph";
import { fetchWithTimeout } from "@/lib/connections/http";
import type { HistoryMedia } from "@/lib/plan/types";

export type HistoryInsert = {
  platform: "facebook" | "instagram";
  external_id: string;
  published_at: string;
  caption: string;
  media: HistoryMedia[];
  permalink: string | null;
  likes: number;
  comments: number;
  shares: number;
  reach: number | null;
};

const FB_FIELDS = "message,created_time,permalink_url,attachments{media_type,media,subattachments},likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions_unique)";
const IG_REACH = "insights.metric(reach)";
const IG_FIELDS = `caption,timestamp,permalink,media_type,media_url,thumbnail_url,like_count,comments_count,${IG_REACH}`;
/** Drops the inline reach request from a Graph `fields` value. */
const withoutReach = (fields: string) => fields.split(",").filter((f) => f !== IG_REACH).join(",");
export const PAGE_SIZE = 25;

type Paged<T> = { data?: T[]; paging?: { next?: string } };
type FbPost = {
  id: string; message?: string; created_time: string; permalink_url?: string;
  attachments?: { data?: { media_type?: string; media?: { image?: { src?: string } }; subattachments?: { data?: { media?: { image?: { src?: string } } }[] } }[] };
  likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number };
  insights?: { data?: { name: string; values?: { value?: number }[] }[] };
};
type IgMedia = { id: string; caption?: string; timestamp: string; permalink?: string; media_type?: string; media_url?: string; thumbnail_url?: string; like_count?: number; comments_count?: number; insights?: { data?: { name: string; values?: { value?: number }[] }[] } };

const iso = (s: string) => new Date(s).toISOString();
const metric = (ins: FbPost["insights"], name: string) => ins?.data?.find((d) => d.name === name)?.values?.[0]?.value ?? null;

export function parseFacebookPosts(payload: unknown): { rows: HistoryInsert[]; next: string | null } {
  const p = payload as Paged<FbPost>;
  const rows = (p.data ?? []).map((post): HistoryInsert => {
    const media: HistoryMedia[] = [];
    for (const a of post.attachments?.data ?? []) {
      const subs = a.subattachments?.data ?? [];
      if (subs.length) for (const s of subs) { const url = s.media?.image?.src; if (url) media.push({ url, kind: "carousel" }); }
      else { const url = a.media?.image?.src; if (url) media.push({ url, kind: a.media_type === "video" ? "video" : "image" }); }
    }
    return {
      platform: "facebook", external_id: post.id, published_at: iso(post.created_time), caption: post.message ?? "", media, permalink: post.permalink_url ?? null,
      likes: post.likes?.summary?.total_count ?? 0, comments: post.comments?.summary?.total_count ?? 0, shares: post.shares?.count ?? 0, reach: metric(post.insights, "post_impressions_unique"),
    };
  });
  return { rows, next: p.paging?.next ?? null };
}

export function parseInstagramMedia(payload: unknown): { rows: HistoryInsert[]; next: string | null } {
  const p = payload as Paged<IgMedia>;
  const rows = (p.data ?? []).map((m): HistoryInsert => {
    const kind: HistoryMedia["kind"] = m.media_type === "VIDEO" ? "video" : m.media_type === "CAROUSEL_ALBUM" ? "carousel" : "image";
    const url = kind === "video" ? (m.thumbnail_url ?? m.media_url) : m.media_url;
    return {
      platform: "instagram", external_id: m.id, published_at: iso(m.timestamp), caption: m.caption ?? "", media: url ? [{ url, kind }] : [], permalink: m.permalink ?? null,
      likes: m.like_count ?? 0, comments: m.comments_count ?? 0, shares: 0, reach: metric(m.insights, "reach"),
    };
  });
  return { rows, next: p.paging?.next ?? null };
}

async function fetchCursorPage(cursorUrl: string, token: string, fetchImpl: typeof fetch): Promise<unknown> {
  const u = new URL(cursorUrl);
  u.searchParams.set("access_token", token);
  const res = await fetchWithTimeout(u, {}, 20_000, fetchImpl);
  const text = await res.text();
  let json: { error?: { message?: string; code?: number } };
  try {
    json = JSON.parse(text);
  } catch {
    throw new GraphError(`Meta history page failed (${res.status}): non-JSON response`, res.status);
  }
  if (!res.ok || json.error) throw new GraphError(`Meta history page failed (${res.status}): ${json.error?.message ?? res.statusText}`, res.status, json.error?.code);
  return json;
}

/**
 * One page of history. cursorUrl (Graph's paging.next) is followed verbatim; the first page is built from the edge + fields.
 * Instagram: Graph rejects a whole page with code 100 (subcode 2108006, "Media posted before business account conversion") when
 * any item on it predates conversion and reach was requested inline, so such a page is retried once without the reach field
 * (those rows get reach null) instead of stopping the backfill.
 */
export async function fetchHistoryPage(i: { platform: "facebook" | "instagram"; token: string; pageId: string; igUserId?: string; cursorUrl: string | null; since?: string; fetchImpl?: typeof fetch }): Promise<{ rows: HistoryInsert[]; next: string | null }> {
  const fetchImpl = i.fetchImpl ?? fetch;
  let payload: unknown;
  if (i.platform === "facebook") {
    payload = i.cursorUrl
      ? await fetchCursorPage(i.cursorUrl, i.token, fetchImpl)
      : await graphFetch(`/${i.pageId}/posts`, { token: i.token, params: { fields: FB_FIELDS, limit: String(PAGE_SIZE), ...(i.since ? { since: i.since } : {}) }, fetchImpl });
    return parseFacebookPosts(payload);
  }
  if (!i.igUserId) throw new Error("Instagram account is not linked to this Page");
  const request = (fields: (f: string) => string) => {
    if (i.cursorUrl) {
      const u = new URL(i.cursorUrl);
      u.searchParams.set("fields", fields(u.searchParams.get("fields") ?? IG_FIELDS));
      return fetchCursorPage(u.toString(), i.token, fetchImpl);
    }
    return graphFetch(`/${i.igUserId}/media`, { token: i.token, params: { fields: fields(IG_FIELDS), limit: String(PAGE_SIZE), ...(i.since ? { since: i.since } : {}) }, fetchImpl });
  };
  try {
    payload = await request((f) => f);
  } catch (e) {
    if (!(e instanceof GraphError) || e.code !== 100) throw e;
    payload = await request(withoutReach);
  }
  return parseInstagramMedia(payload);
}
