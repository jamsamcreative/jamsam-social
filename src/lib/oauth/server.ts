import { sha256, randomToken, verifyPkce, validateRedirectUri, isExpired, inSeconds, ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS, CODE_TTL_SECONDS } from "./core";
import type { OauthStore } from "./store";

export class OauthError extends Error {
  constructor(
    public code: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type" | "invalid_redirect_uri" | "unauthorized_client",
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "OauthError";
  }
}

/** RFC 7591 dynamic registration. Public clients only (no secret); PKCE carries the security. */
export async function registerClient(store: OauthStore, body: unknown) {
  const b = (body ?? {}) as { client_name?: unknown; redirect_uris?: unknown };
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (uris.length === 0) throw new OauthError("invalid_redirect_uri", "redirect_uris is required");
  for (const u of uris) if (!validateRedirectUri([u], u)) throw new OauthError("invalid_redirect_uri", `redirect_uri not allowed: ${u}`);
  const client = await store.createClient({ client_id: randomToken(16), client_name: typeof b.client_name === "string" ? b.client_name.slice(0, 200) : null, redirect_uris: uris });
  return {
    client_id: client.client_id,
    client_name: client.client_name,
    redirect_uris: client.redirect_uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_id_issued_at: Math.floor(Date.parse(client.created_at) / 1000),
  };
}

export type AuthorizeParams = { client_id: string; redirect_uri: string; response_type: string; code_challenge: string; code_challenge_method: string; state?: string; scope?: string; resource?: string };

/** Validates an authorization request before we show the consent screen. */
export async function validateAuthorize(store: OauthStore, p: Partial<AuthorizeParams>): Promise<{ client: { client_id: string; client_name: string | null }; params: AuthorizeParams }> {
  if (!p.client_id) throw new OauthError("invalid_request", "client_id is required");
  const client = await store.getClient(p.client_id);
  if (!client) throw new OauthError("invalid_client", "Unknown client_id");
  if (!p.redirect_uri || !validateRedirectUri(client.redirect_uris, p.redirect_uri)) throw new OauthError("invalid_redirect_uri", "redirect_uri does not match the registered client");
  if (p.response_type !== "code") throw new OauthError("invalid_request", "response_type must be 'code'");
  if (!p.code_challenge || p.code_challenge_method !== "S256") throw new OauthError("invalid_request", "PKCE with S256 is required");
  return { client: { client_id: client.client_id, client_name: client.client_name }, params: p as AuthorizeParams };
}

/** After the user consents: mint a single-use code and build the redirect. */
export async function issueCode(store: OauthStore, p: AuthorizeParams, userId: string): Promise<string> {
  const code = randomToken(32);
  await store.createCode({
    code_hash: sha256(code), client_id: p.client_id, user_id: userId, redirect_uri: p.redirect_uri, code_challenge: p.code_challenge,
    scope: p.scope ?? null, resource: p.resource ?? null, expires_at: inSeconds(CODE_TTL_SECONDS),
  });
  const u = new URL(p.redirect_uri);
  u.searchParams.set("code", code);
  if (p.state) u.searchParams.set("state", p.state);
  return u.toString();
}

async function mint(store: OauthStore, clientId: string, userId: string, scope: string | null) {
  const access = randomToken(32);
  const refresh = randomToken(32);
  await store.createToken({
    client_id: clientId, user_id: userId, access_token_hash: sha256(access), refresh_token_hash: sha256(refresh), scope,
    access_expires_at: inSeconds(ACCESS_TTL_SECONDS), refresh_expires_at: inSeconds(REFRESH_TTL_SECONDS),
  });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_SECONDS, refresh_token: refresh, scope: scope ?? undefined };
}

/** Token endpoint: authorization_code (with PKCE) or refresh_token (rotating). */
export async function exchangeToken(store: OauthStore, form: Record<string, string | undefined>) {
  const grant = form.grant_type;
  if (grant === "authorization_code") {
    const { code, redirect_uri, client_id, code_verifier } = form;
    if (!code || !code_verifier || !client_id) throw new OauthError("invalid_request", "code, client_id and code_verifier are required");
    const row = await store.consumeCode(sha256(code));
    if (!row) throw new OauthError("invalid_grant", "Unknown or already used code");
    if (isExpired(row.expires_at)) throw new OauthError("invalid_grant", "Code expired");
    if (row.client_id !== client_id) throw new OauthError("invalid_grant", "Code was issued to a different client");
    if (redirect_uri && redirect_uri !== row.redirect_uri) throw new OauthError("invalid_grant", "redirect_uri mismatch");
    if (!verifyPkce(code_verifier, row.code_challenge)) throw new OauthError("invalid_grant", "PKCE verification failed");
    return mint(store, row.client_id, row.user_id, row.scope);
  }
  if (grant === "refresh_token") {
    const { refresh_token, client_id } = form;
    if (!refresh_token) throw new OauthError("invalid_request", "refresh_token is required");
    const row = await store.getTokenByRefreshHash(sha256(refresh_token));
    if (!row || row.revoked_at) throw new OauthError("invalid_grant", "Unknown or revoked refresh token");
    if (client_id && client_id !== row.client_id) throw new OauthError("invalid_grant", "Token belongs to a different client");
    if (isExpired(row.refresh_expires_at)) throw new OauthError("invalid_grant", "Refresh token expired");
    const access = randomToken(32);
    const refresh = randomToken(32);
    await store.rotateToken(row.id, { access_token_hash: sha256(access), refresh_token_hash: sha256(refresh), access_expires_at: inSeconds(ACCESS_TTL_SECONDS), refresh_expires_at: inSeconds(REFRESH_TTL_SECONDS) });
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_SECONDS, refresh_token: refresh, scope: row.scope ?? undefined };
  }
  throw new OauthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
}

/** Resolves a bearer access token to its user, or null. */
export async function verifyAccessToken(store: OauthStore, token: string): Promise<{ user_id: string; client_id: string } | null> {
  const row = await store.getTokenByAccessHash(sha256(token));
  if (!row || row.revoked_at || isExpired(row.access_expires_at)) return null;
  void store.touchToken(row.id);
  return { user_id: row.user_id, client_id: row.client_id };
}
