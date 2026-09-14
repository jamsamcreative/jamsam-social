import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import { encryptJson } from "@/lib/crypto";
import { env } from "@/lib/env";
import type { PinterestConfig, PinterestSecret } from "@/lib/connections/pinterest";
import { needsRefresh, refreshAccessToken } from "./client";

/** A valid Pinterest access token for the brand, refreshing (and persisting) when close to expiry. Marks the connection failing if refresh fails. */
export async function withPinterestToken(brandId: string): Promise<{ token: string; config: PinterestConfig } | null> {
  const conn = await getConnectionWithSecret<PinterestConfig, PinterestSecret>(brandId, "pinterest");
  if (!conn) return null;
  const admin = createAdminSupabase();
  if (needsRefresh(conn.secret.expires_at) && conn.secret.refresh_token && env.PINTEREST_APP_ID && env.PINTEREST_APP_SECRET) {
    try {
      const t = await refreshAccessToken(env.PINTEREST_APP_ID, env.PINTEREST_APP_SECRET, conn.secret.refresh_token);
      const secret: PinterestSecret = { access_token: t.access_token, refresh_token: t.refresh_token ?? conn.secret.refresh_token, expires_at: t.expires_at };
      await admin.from("brand_connections").update({ secret: encryptJson(secret), status: "connected", last_error: null, last_checked: new Date().toISOString() }).eq("id", conn.id);
      return { token: t.access_token, config: conn.config };
    } catch (e) {
      await admin.from("brand_connections").update({ status: "failing", last_error: `Token refresh failed: ${e instanceof Error ? e.message : String(e)}. Reconnect Pinterest.`, last_checked: new Date().toISOString() }).eq("id", conn.id);
      throw e;
    }
  }
  return { token: conn.secret.access_token, config: conn.config };
}
