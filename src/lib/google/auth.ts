import { JWT } from "google-auth-library";
import { env } from "@/lib/env";

export type ServiceAccount = { email: string; key: string; projectId?: string };

/** Parses GOOGLE_SERVICE_ACCOUNT_JSON; null when unset or malformed (cards then show "not configured"). */
export function serviceAccount(raw = env.GOOGLE_SERVICE_ACCOUNT_JSON): ServiceAccount | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { client_email?: string; private_key?: string; project_id?: string };
    if (!j.client_email || !j.private_key) return null;
    return { email: j.client_email, key: j.private_key.replace(/\\n/g, "\n"), projectId: j.project_id };
  } catch {
    return null;
  }
}

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

const cache = new Map<string, { token: string; expires: number }>();

/** Service-account access token for the given scopes, cached until shortly before expiry. */
export async function googleAccessToken(scopes: string[], sa = serviceAccount()): Promise<string> {
  if (!sa) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
  const key = scopes.slice().sort().join(" ");
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  const client = new JWT({ email: sa.email, key: sa.key, scopes });
  const { token, expiry_date } = await client.getAccessToken().then((r) => ({ token: r.token, expiry_date: client.credentials.expiry_date }));
  if (!token) throw new Error("Google did not return an access token");
  cache.set(key, { token, expires: expiry_date ?? Date.now() + 50 * 60_000 });
  return token;
}
