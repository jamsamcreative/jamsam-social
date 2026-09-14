import { fetchWithTimeout } from "@/lib/connections/http";
import { PINTEREST_API } from "@/lib/connections/pinterest";

export const PINTEREST_SCOPES = ["boards:read", "boards:write", "pins:read", "pins:write", "user_accounts:read"];

export class PinterestError extends Error {
  constructor(message: string, public status: number, public code?: number) {
    super(message);
    this.name = "PinterestError";
  }
}

export function pinterestAuthUrl(opts: { appId: string; redirectUri: string; state: string }): string {
  const u = new URL("https://www.pinterest.com/oauth/");
  u.searchParams.set("client_id", opts.appId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", PINTEREST_SCOPES.join(","));
  u.searchParams.set("state", opts.state);
  return u.toString();
}

export type PinterestTokens = { access_token: string; refresh_token?: string; expires_at: string; refresh_expires_at?: string };

async function tokenRequest(appId: string, secret: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<PinterestTokens> {
  const res = await fetchWithTimeout(`${PINTEREST_API}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  }, 20_000, fetchImpl);
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; message?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new PinterestError(body.message ?? body.error_description ?? `Pinterest token endpoint responded ${res.status}`, res.status);
  const now = Date.now();
  return {
    access_token: body.access_token, refresh_token: body.refresh_token,
    expires_at: new Date(now + (body.expires_in ?? 2_592_000) * 1000).toISOString(),
    refresh_expires_at: body.refresh_token_expires_in ? new Date(now + body.refresh_token_expires_in * 1000).toISOString() : undefined,
  };
}

export const exchangeCode = (appId: string, secret: string, code: string, redirectUri: string, fetchImpl: typeof fetch = fetch) =>
  tokenRequest(appId, secret, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, fetchImpl);
export const refreshAccessToken = (appId: string, secret: string, refreshToken: string, fetchImpl: typeof fetch = fetch) =>
  tokenRequest(appId, secret, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);

/** Refresh when the access token has less than 3 days left (Pinterest access tokens live 30 days). */
export function needsRefresh(expiresAt: string | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) - now < 3 * 86_400_000;
}

async function api<T>(path: string, token: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchWithTimeout(`${PINTEREST_API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) } }, 30_000, fetchImpl);
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch {}
  if (!res.ok) {
    const b = body as { message?: string; code?: number } | null;
    throw new PinterestError(b?.message ?? `Pinterest responded ${res.status}`, res.status, b?.code);
  }
  return body as T;
}

export type PinterestBoard = { id: string; name: string; privacy?: string; pin_count?: number };
export async function listBoards(token: string, fetchImpl: typeof fetch = fetch): Promise<PinterestBoard[]> {
  const out: PinterestBoard[] = [];
  let bookmark: string | undefined;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ page_size: "100" });
    if (bookmark) q.set("bookmark", bookmark);
    const r = await api<{ items?: PinterestBoard[]; bookmark?: string | null }>(`/boards?${q}`, token, {}, fetchImpl);
    out.push(...(r.items ?? []));
    if (!r.bookmark) break;
    bookmark = r.bookmark;
  }
  return out;
}

export async function userAccount(token: string, fetchImpl: typeof fetch = fetch): Promise<{ username?: string; account_type?: string }> {
  return api("/user_account", token, {}, fetchImpl);
}

export type CreatePinPayload = { board_id: string; title: string; description: string; link?: string; alt_text?: string; media_source: { source_type: "image_url"; url: string } };
export async function createPin(token: string, payload: CreatePinPayload, fetchImpl: typeof fetch = fetch): Promise<{ id: string; url: string }> {
  const r = await api<{ id: string }>("/pins", token, { method: "POST", body: JSON.stringify(payload) }, fetchImpl);
  return { id: r.id, url: `https://www.pinterest.com/pin/${r.id}/` };
}

export type PinInsights = { impressions: number; saves: number; pin_clicks: number; outbound_clicks: number; fetched_at: string };
export async function pinAnalytics(token: string, pinId: string, startDate: string, endDate: string, fetchImpl: typeof fetch = fetch): Promise<PinInsights> {
  const q = new URLSearchParams({ start_date: startDate, end_date: endDate, metric_types: "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK" });
  const r = await api<{ all?: { lifetime_metrics?: Record<string, number> } }>(`/pins/${pinId}/analytics?${q}`, token, {}, fetchImpl);
  const m = r.all?.lifetime_metrics ?? {};
  return { impressions: m.IMPRESSION ?? 0, saves: m.SAVE ?? 0, pin_clicks: m.PIN_CLICK ?? 0, outbound_clicks: m.OUTBOUND_CLICK ?? 0, fetched_at: new Date().toISOString() };
}
