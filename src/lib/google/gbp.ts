import { googleJson, type GoogleDeps } from "./api";
import { env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/connections/http";

export const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

export function gbpAuthUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", `${GBP_SCOPE} openid email`);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenPost(params: Record<string, string>, fetchImpl: typeof fetch = fetch) {
  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) }, 15_000, fetchImpl);
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) throw new Error(body.error_description ?? body.error ?? `Google token endpoint responded ${res.status}`);
  return body;
}

export async function gbpExchangeCode(code: string, redirectUri: string, fetchImpl?: typeof fetch) {
  return tokenPost({ code, client_id: env.GOOGLE_OAUTH_CLIENT_ID ?? "", client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? "", redirect_uri: redirectUri, grant_type: "authorization_code" }, fetchImpl);
}

export async function gbpAccessToken(refreshToken: string, fetchImpl?: typeof fetch): Promise<string> {
  const b = await tokenPost({ refresh_token: refreshToken, client_id: env.GOOGLE_OAUTH_CLIENT_ID ?? "", client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? "", grant_type: "refresh_token" }, fetchImpl);
  return b.access_token!;
}

export type GbpLocation = { name: string; title: string };

export async function gbpListLocations(deps: GoogleDeps): Promise<GbpLocation[]> {
  const accounts = await googleJson<{ accounts?: { name: string }[] }>("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", deps);
  const out: GbpLocation[] = [];
  for (const a of accounts.accounts ?? []) {
    const r = await googleJson<{ locations?: { name: string; title?: string }[] }>(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title&pageSize=100`, deps);
    for (const l of r.locations ?? []) out.push({ name: l.name, title: l.title ?? l.name });
  }
  return out;
}

export type GbpPostPayload = { languageCode: string; summary: string; topicType: "STANDARD"; media?: { mediaFormat: "PHOTO"; sourceUrl: string }[]; callToAction?: { actionType: "LEARN_MORE"; url: string } };

/** GBP summaries are capped at 1,500 chars; hashtags and emojis are allowed but a link goes in the CTA, not the text. */
export function buildGbpPost(input: { caption: string; link_url: string | null; media: { url: string }[] }): GbpPostPayload {
  const summary = input.caption.replace(/https?:\/\/\S+/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500);
  const p: GbpPostPayload = { languageCode: "en-US", summary, topicType: "STANDARD" };
  if (input.media[0]) p.media = [{ mediaFormat: "PHOTO", sourceUrl: input.media[0].url }];
  if (input.link_url) p.callToAction = { actionType: "LEARN_MORE", url: input.link_url };
  return p;
}

export async function gbpCreatePost(locationName: string, payload: GbpPostPayload, deps: GoogleDeps): Promise<{ name: string; searchUrl: string | null }> {
  const r = await googleJson<{ name: string; searchUrl?: string }>(`https://mybusiness.googleapis.com/v4/${locationName}/localPosts`, deps, { method: "POST", body: JSON.stringify(payload) });
  return { name: r.name, searchUrl: r.searchUrl ?? null };
}
