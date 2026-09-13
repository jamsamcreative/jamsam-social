import { graphFetch } from "@/lib/meta/graph";
import type { PublishInput, PublishResult } from "./types";

type Opts = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFinished(id: string, token: string, fetchImpl: typeof fetch, sleep: (ms: number) => Promise<void>) {
  for (let i = 0; i < 15; i++) {
    const r = await graphFetch<{ status_code?: string; status?: string }>(`/${id}`, { token, params: { fields: "status_code,status" }, fetchImpl });
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED") throw new Error(`Instagram container ${r.status_code}: ${r.status ?? "unknown"}`);
    await sleep(2000);
  }
  throw new Error("Instagram container did not finish processing in time");
}

export async function publishToInstagram(igUserId: string, token: string, input: PublishInput, opts: Opts = {}): Promise<PublishResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  if (input.media.length === 0) throw new Error("Instagram posts need at least one image");
  const post = { token, method: "POST" as const, fetchImpl };

  let creationId: string;
  if (input.media.length === 1) {
    const r = await graphFetch<{ id: string }>(`/${igUserId}/media`, { ...post, body: { image_url: input.media[0].url, caption: input.caption } });
    creationId = r.id;
  } else {
    const children: string[] = [];
    for (const m of input.media) {
      const r = await graphFetch<{ id: string }>(`/${igUserId}/media`, { ...post, body: { image_url: m.url, is_carousel_item: "true" } });
      children.push(r.id);
    }
    for (const c of children) await waitFinished(c, token, fetchImpl, sleep);
    const r = await graphFetch<{ id: string }>(`/${igUserId}/media`, { ...post, body: { media_type: "CAROUSEL", children, caption: input.caption } });
    creationId = r.id;
  }
  await waitFinished(creationId, token, fetchImpl, sleep);
  const pub = await graphFetch<{ id: string }>(`/${igUserId}/media_publish`, { ...post, body: { creation_id: creationId } });
  let permalink: string | null = null;
  try {
    permalink = (await graphFetch<{ permalink?: string }>(`/${pub.id}`, { token, params: { fields: "permalink" }, fetchImpl })).permalink ?? null;
  } catch {}
  return { external_id: pub.id, external_url: permalink };
}
