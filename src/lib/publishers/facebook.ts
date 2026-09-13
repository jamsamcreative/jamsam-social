import { graphFetch } from "@/lib/meta/graph";
import type { PublishInput, PublishResult } from "./types";

export async function publishToFacebook(pageId: string, token: string, input: PublishInput, fetchImpl: typeof fetch = fetch): Promise<PublishResult> {
  const base = { token, method: "POST" as const, fetchImpl };
  let postId: string;
  if (input.media.length === 0) {
    const r = await graphFetch<{ id: string }>(`/${pageId}/feed`, { ...base, body: { message: input.caption, link: input.link_url ?? undefined } });
    postId = r.id;
  } else if (input.media.length === 1) {
    const r = await graphFetch<{ id: string; post_id?: string }>(`/${pageId}/photos`, { ...base, body: { url: input.media[0].url, message: input.caption } });
    postId = r.post_id ?? r.id;
  } else {
    const ids: string[] = [];
    for (const m of input.media) {
      const r = await graphFetch<{ id: string }>(`/${pageId}/photos`, { ...base, body: { url: m.url, published: "false" } });
      ids.push(r.id);
    }
    const r = await graphFetch<{ id: string }>(`/${pageId}/feed`, { ...base, body: { message: input.caption, attached_media: ids.map((id) => ({ media_fbid: id })) } });
    postId = r.id;
  }
  return { external_id: postId, external_url: `https://www.facebook.com/${postId}` };
}
