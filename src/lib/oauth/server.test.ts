import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { registerClient, validateAuthorize, issueCode, exchangeToken, verifyAccessToken, OauthError } from "@/lib/oauth/server";
import { fakeOauthStore } from "@/lib/oauth/fake-store";

const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const USER = "3f5c1c1e-1b9a-4c1e-9a1e-1b9a4c1e9a1e";

async function fullFlow(store = fakeOauthStore()) {
  const reg = await registerClient(store, { client_name: "Claude", redirect_uris: [REDIRECT] });
  const { params } = await validateAuthorize(store, { client_id: reg.client_id, redirect_uri: REDIRECT, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "xyz", scope: "mcp" });
  const location = await issueCode(store, params, USER);
  const u = new URL(location);
  expect(u.origin + u.pathname).toBe(REDIRECT);
  expect(u.searchParams.get("state")).toBe("xyz");
  const code = u.searchParams.get("code")!;
  return { store, reg, code };
}

describe("oauth server", () => {
  it("registers a public client and rejects bad redirect URIs", async () => {
    const store = fakeOauthStore();
    const reg = await registerClient(store, { client_name: "Claude", redirect_uris: [REDIRECT] });
    expect(reg).toMatchObject({ token_endpoint_auth_method: "none", redirect_uris: [REDIRECT] });
    await expect(registerClient(store, { redirect_uris: ["http://evil.com/x"] })).rejects.toThrow(/not allowed/);
    await expect(registerClient(store, {})).rejects.toThrow(/redirect_uris/);
  });
  it("validateAuthorize enforces client, exact redirect, code + S256", async () => {
    const store = fakeOauthStore();
    const reg = await registerClient(store, { redirect_uris: [REDIRECT] });
    const base = { client_id: reg.client_id, redirect_uri: REDIRECT, response_type: "code", code_challenge: challenge, code_challenge_method: "S256" };
    await expect(validateAuthorize(store, { ...base, client_id: "nope" })).rejects.toThrow(/Unknown client/);
    await expect(validateAuthorize(store, { ...base, redirect_uri: REDIRECT + "?x" })).rejects.toThrow(/redirect_uri/);
    await expect(validateAuthorize(store, { ...base, code_challenge_method: "plain" })).rejects.toThrow(/S256/);
    expect((await validateAuthorize(store, base)).client.client_id).toBe(reg.client_id);
  });
  it("exchanges a code with PKCE for tokens, once only", async () => {
    const { store, reg, code } = await fullFlow();
    const tok = await exchangeToken(store, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier });
    expect(tok).toMatchObject({ token_type: "Bearer", expires_in: 86400, scope: "mcp" });
    expect(await verifyAccessToken(store, tok.access_token)).toEqual({ user_id: USER, client_id: reg.client_id });
    await expect(exchangeToken(store, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier })).rejects.toThrow(/already used/);
  });
  it("rejects a wrong verifier or client", async () => {
    const a = await fullFlow();
    await expect(exchangeToken(a.store, { grant_type: "authorization_code", code: a.code, client_id: a.reg.client_id, code_verifier: "wrong" })).rejects.toThrow(/PKCE/);
    const b = await fullFlow();
    await expect(exchangeToken(b.store, { grant_type: "authorization_code", code: b.code, client_id: "other", code_verifier: verifier })).rejects.toThrow(/different client/);
  });
  it("refresh rotates both tokens and invalidates the old access token", async () => {
    const { store, reg, code } = await fullFlow();
    const t1 = await exchangeToken(store, { grant_type: "authorization_code", code, client_id: reg.client_id, code_verifier: verifier });
    const t2 = await exchangeToken(store, { grant_type: "refresh_token", refresh_token: t1.refresh_token, client_id: reg.client_id });
    expect(t2.access_token).not.toBe(t1.access_token);
    expect(await verifyAccessToken(store, t1.access_token)).toBeNull();
    expect(await verifyAccessToken(store, t2.access_token)).not.toBeNull();
    await expect(exchangeToken(store, { grant_type: "refresh_token", refresh_token: t1.refresh_token })).rejects.toThrow(/Unknown or revoked/);
  });
  it("revoked and unknown tokens do not verify; unsupported grants error", async () => {
    const { store, reg, code } = await fullFlow();
    const t = await exchangeToken(store, { grant_type: "authorization_code", code, client_id: reg.client_id, code_verifier: verifier });
    await store.revokeToken(store.tokens[0].id);
    expect(await verifyAccessToken(store, t.access_token)).toBeNull();
    expect(await verifyAccessToken(store, "garbage")).toBeNull();
    await expect(exchangeToken(store, { grant_type: "password" })).rejects.toBeInstanceOf(OauthError);
  });
});
