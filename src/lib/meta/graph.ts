import { fetchWithTimeout } from "@/lib/connections/http";

export const GRAPH = "https://graph.facebook.com/v21.0";

export class GraphError extends Error {
  code?: number;
  status: number;
  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.code = code;
  }
}

type Opts = {
  token: string;
  method?: "GET" | "POST";
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
};

export async function graphFetch<T = Record<string, unknown>>(path: string, opts: Opts): Promise<T> {
  const url = new URL(`${GRAPH}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
  const method = opts.method ?? "GET";
  let init: RequestInit = {};
  if (method === "GET") {
    url.searchParams.set("access_token", opts.token);
  } else {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.body ?? {})) {
      if (v === undefined || v === null) continue;
      form.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    form.set("access_token", opts.token);
    init = { method: "POST", body: form.toString(), headers: { "Content-Type": "application/x-www-form-urlencoded" } };
  }
  const res = await fetchWithTimeout(url, init, 20_000, opts.fetchImpl ?? fetch);
  const text = await res.text();
  let json: { error?: { message?: string; code?: number } } & T;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GraphError(`Graph API returned non-JSON (${res.status})`, res.status);
  }
  if (!res.ok || json.error) throw new GraphError(json.error?.message ?? `Graph API error ${res.status}`, res.status, json.error?.code);
  return json as T;
}
