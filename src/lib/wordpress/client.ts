import { fetchWithTimeout } from "@/lib/connections/http";
import { wpAuthHeader, wpBase, type WordpressConfig, type WordpressSecret } from "@/lib/connections/wordpress-shared";
import type { TermRef } from "@/lib/database.types";

export class WpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WpError";
    this.status = status;
  }
}

export type WpClient = {
  siteUrl: string;
  get<T>(path: string, params?: Record<string, string>): Promise<{ data: T; headers: Headers }>;
  post<T>(path: string, body: unknown, opts?: { raw?: { bytes: Buffer; contentType: string; filename: string } }): Promise<T>;
};

export function createWpClient(config: WordpressConfig, secret: WordpressSecret, fetchImpl: typeof fetch = fetch): WpClient {
  const base = `${wpBase(config.site_url)}/wp-json`;
  const auth = wpAuthHeader(config.username, secret.app_password);
  async function parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {}
    if (!res.ok) {
      const msg = (json as { message?: string } | null)?.message ?? `WordPress responded ${res.status}`;
      throw new WpError(msg, res.status);
    }
    if (json === null) throw new WpError("WordPress did not return JSON", res.status);
    return json as T;
  }
  return {
    siteUrl: wpBase(config.site_url),
    async get(path, params) {
      const u = new URL(`${base}${path}`);
      for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
      const res = await fetchWithTimeout(u, { headers: { Authorization: auth, Accept: "application/json" } }, 20_000, fetchImpl);
      return { data: await parse(res), headers: res.headers };
    },
    async post(path, body, opts) {
      const headers: Record<string, string> = { Authorization: auth, Accept: "application/json" };
      let payload: BodyInit;
      if (opts?.raw) {
        headers["Content-Type"] = opts.raw.contentType;
        headers["Content-Disposition"] = `attachment; filename="${opts.raw.filename}"`;
        payload = new Uint8Array(opts.raw.bytes);
      } else {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const res = await fetchWithTimeout(`${base}${path}`, { method: "POST", headers, body: payload }, 20_000, fetchImpl);
      return parse(res);
    },
  };
}

export async function listTerms(client: WpClient, kind: "categories" | "tags"): Promise<TermRef[]> {
  const out: TermRef[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, headers } = await client.get<{ id: number; name: string }[]>(`/wp/v2/${kind}`, { per_page: "100", page: String(page), _fields: "id,name" });
    out.push(...data.map((t) => ({ id: t.id, name: t.name })));
    if (page >= Number(headers.get("X-WP-TotalPages") ?? "1")) break;
  }
  return out;
}

export async function uploadMediaFromUrl(
  client: WpClient,
  url: string,
  opts: { alt: string; filename?: string; fetchImpl?: typeof fetch },
): Promise<{ id: number; source_url: string }> {
  const f = opts.fetchImpl ?? fetch;
  const src = await fetchWithTimeout(url, {}, 20_000, f);
  if (!src.ok) throw new WpError(`Could not download image ${url} (${src.status})`, src.status);
  const contentType = src.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const bytes = Buffer.from(await src.arrayBuffer());
  const filename = opts.filename ?? (new URL(url).pathname.split("/").pop() || "image.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
  const created = await client.post<{ id: number; source_url: string }>("/wp/v2/media", null, { raw: { bytes, contentType, filename } });
  await client.post(`/wp/v2/media/${created.id}`, { alt_text: opts.alt, title: opts.alt || filename });
  return { id: created.id, source_url: created.source_url };
}

export type WpPostPayload = {
  title: string;
  slug: string;
  content: string;
  excerpt?: string;
  status: "draft" | "publish" | "future";
  date_gmt?: string;
  categories?: number[];
  tags?: number[];
  featured_media?: number;
  meta?: Record<string, string>;
};
export type WpPostResult = { id: number; link: string; status: string; date_gmt: string; slug: string };
const POST_FIELDS = "id,link,status,date_gmt,slug";

export async function createPost(client: WpClient, payload: WpPostPayload): Promise<WpPostResult> {
  return client.post<WpPostResult>(`/wp/v2/posts?_fields=${POST_FIELDS}`, payload);
}
export async function updatePost(client: WpClient, id: number, payload: Partial<WpPostPayload>): Promise<WpPostResult> {
  return client.post<WpPostResult>(`/wp/v2/posts/${id}?_fields=${POST_FIELDS}`, payload);
}
export async function getPost(client: WpClient, id: number): Promise<WpPostResult> {
  return (await client.get<WpPostResult>(`/wp/v2/posts/${id}`, { _fields: POST_FIELDS, context: "edit" })).data;
}

export async function checkHelper(client: WpClient): Promise<{ installed: boolean; version?: string }> {
  try {
    const { data } = await client.get<{ ok?: boolean; version?: string }>("/jamsam/v1/ping");
    return data.ok ? { installed: true, version: data.version } : { installed: false };
  } catch {
    return { installed: false };
  }
}
