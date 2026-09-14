import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";

export type OauthClient = Database["public"]["Tables"]["oauth_clients"]["Row"];
export type OauthCode = Database["public"]["Tables"]["oauth_codes"]["Row"];
export type OauthToken = Database["public"]["Tables"]["oauth_tokens"]["Row"];

export type OauthStore = {
  createClient(input: { client_id: string; client_name: string | null; redirect_uris: string[] }): Promise<OauthClient>;
  getClient(clientId: string): Promise<OauthClient | null>;
  createCode(input: Omit<OauthCode, "used_at" | "created_at">): Promise<void>;
  /** Atomically marks the code used; returns null if unknown or already used. */
  consumeCode(codeHash: string): Promise<OauthCode | null>;
  createToken(input: Omit<OauthToken, "id" | "revoked_at" | "last_used_at" | "created_at">): Promise<OauthToken>;
  getTokenByAccessHash(hash: string): Promise<OauthToken | null>;
  getTokenByRefreshHash(hash: string): Promise<OauthToken | null>;
  rotateToken(id: string, patch: Pick<OauthToken, "access_token_hash" | "refresh_token_hash" | "access_expires_at" | "refresh_expires_at">): Promise<void>;
  touchToken(id: string): Promise<void>;
  revokeToken(id: string): Promise<void>;
  listTokensForUser(userId: string): Promise<(OauthToken & { client_name: string | null })[]>;
};

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? "Database error");
}

export function createSupabaseOauthStore(admin = createAdminSupabase()): OauthStore {
  return {
    async createClient(input) {
      const { data, error } = await admin.from("oauth_clients").insert(input).select("*").single();
      if (error || !data) fail(error);
      return data;
    },
    async getClient(clientId) {
      const { data } = await admin.from("oauth_clients").select("*").eq("client_id", clientId).maybeSingle();
      return data ?? null;
    },
    async createCode(input) {
      const { error } = await admin.from("oauth_codes").insert(input);
      if (error) fail(error);
    },
    async consumeCode(codeHash) {
      const { data, error } = await admin.from("oauth_codes").update({ used_at: new Date().toISOString() }).eq("code_hash", codeHash).is("used_at", null).select("*").maybeSingle();
      if (error) fail(error);
      return data ?? null;
    },
    async createToken(input) {
      const { data, error } = await admin.from("oauth_tokens").insert(input).select("*").single();
      if (error || !data) fail(error);
      return data;
    },
    async getTokenByAccessHash(hash) {
      const { data } = await admin.from("oauth_tokens").select("*").eq("access_token_hash", hash).maybeSingle();
      return data ?? null;
    },
    async getTokenByRefreshHash(hash) {
      const { data } = await admin.from("oauth_tokens").select("*").eq("refresh_token_hash", hash).maybeSingle();
      return data ?? null;
    },
    async rotateToken(id, patch) {
      const { error } = await admin.from("oauth_tokens").update(patch).eq("id", id);
      if (error) fail(error);
    },
    async touchToken(id) {
      await admin.from("oauth_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", id);
    },
    async revokeToken(id) {
      const { error } = await admin.from("oauth_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id);
      if (error) fail(error);
    },
    async listTokensForUser(userId) {
      const [{ data: tokens, error }, { data: clients }] = await Promise.all([
        admin.from("oauth_tokens").select("*").eq("user_id", userId).is("revoked_at", null).order("created_at", { ascending: false }),
        admin.from("oauth_clients").select("client_id,client_name"),
      ]);
      if (error) fail(error);
      const names = new Map((clients ?? []).map((c) => [c.client_id, c.client_name]));
      return (tokens ?? []).map((t) => ({ ...t, client_name: names.get(t.client_id) ?? null }));
    },
  };
}
