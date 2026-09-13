import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { GRAPH, graphFetch } from "./graph";

export const META_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "read_insights",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "business_management",
];

const b64u = (b: Buffer) => b.toString("base64url");
function hmac(data: string) {
  return b64u(createHmac("sha256", Buffer.from(env.CONNECTIONS_ENCRYPTION_KEY, "base64")).update(data).digest());
}

export function signState(payload: { brand: string; nonce: string }): string {
  const data = b64u(Buffer.from(JSON.stringify(payload)));
  return `${data}.${hmac(data)}`;
}

export function verifyState(state: string): { brand: string; nonce: string } | null {
  const [data, sig] = state.split(".");
  if (!data || !sig) return null;
  const expected = hmac(data);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString()) as { brand?: string; nonce?: string };
    return p.brand && p.nonce ? { brand: p.brand, nonce: p.nonce } : null;
  } catch {
    return null;
  }
}

export function buildAuthUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
  const u = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  u.searchParams.set("client_id", env.META_APP_ID);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", META_SCOPES.join(","));
  return u.toString();
}

export async function exchangeCode({ code, redirectUri, fetchImpl = fetch }: { code: string; redirectUri: string; fetchImpl?: typeof fetch }): Promise<string> {
  const short = new URL(`${GRAPH}/oauth/access_token`);
  short.searchParams.set("client_id", env.META_APP_ID);
  short.searchParams.set("client_secret", env.META_APP_SECRET);
  short.searchParams.set("redirect_uri", redirectUri);
  short.searchParams.set("code", code);
  const s = (await (await fetchImpl(short)).json()) as { access_token?: string; error?: { message: string } };
  if (!s.access_token) throw new Error(s.error?.message ?? "Code exchange failed");

  const long = new URL(`${GRAPH}/oauth/access_token`);
  long.searchParams.set("grant_type", "fb_exchange_token");
  long.searchParams.set("client_id", env.META_APP_ID);
  long.searchParams.set("client_secret", env.META_APP_SECRET);
  long.searchParams.set("fb_exchange_token", s.access_token);
  const l = (await (await fetchImpl(long)).json()) as { access_token?: string; error?: { message: string } };
  if (!l.access_token) throw new Error(l.error?.message ?? "Long-lived token exchange failed");
  return l.access_token;
}

export type PageCandidate = { id: string; name: string; access_token: string; ig_user_id?: string; ig_username?: string };

export async function listPages(userToken: string, fetchImpl: typeof fetch = fetch): Promise<PageCandidate[]> {
  const r = await graphFetch<{ data: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[] }>(
    "/me/accounts",
    { token: userToken, params: { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100" }, fetchImpl },
  );
  return r.data.map((p) => ({
    id: p.id,
    name: p.name,
    access_token: p.access_token,
    ig_user_id: p.instagram_business_account?.id,
    ig_username: p.instagram_business_account?.username,
  }));
}

export async function getMe(userToken: string, fetchImpl: typeof fetch = fetch): Promise<{ id: string; name: string }> {
  return graphFetch<{ id: string; name: string }>("/me", { token: userToken, params: { fields: "id,name" }, fetchImpl });
}
