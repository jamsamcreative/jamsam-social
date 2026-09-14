import { describe, it, expect } from "vitest";
import { sha256, randomToken, verifyPkce, validateRedirectUri, isExpired, metadata, ACCESS_TTL_SECONDS } from "@/lib/oauth/core";

describe("oauth core", () => {
  it("hashes deterministically and generates url-safe tokens", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sha256("abc")).not.toBe(sha256("abd"));
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(randomToken()).not.toBe(randomToken());
  });
  it("verifies S256 PKCE", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce("wrong", challenge)).toBe(false);
  });
  it("validates redirect URIs exactly against registration, https or localhost only", () => {
    const uris = ["https://claude.ai/api/mcp/auth_callback", "http://localhost:3333/cb"];
    expect(validateRedirectUri(uris, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(validateRedirectUri(uris, "https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false);
    expect(validateRedirectUri(uris, "http://localhost:3333/cb")).toBe(true);
    expect(validateRedirectUri(uris, "http://evil.com/cb")).toBe(false);
  });
  it("rejects registering non-https, non-localhost redirect URIs", () => {
    expect(validateRedirectUri(["http://evil.com/cb"], "http://evil.com/cb")).toBe(false);
  });
  it("expiry helper", () => {
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(isExpired(new Date(Date.now() + 1000).toISOString())).toBe(false);
  });
  it("metadata documents required endpoints", () => {
    const m = metadata("https://app.test");
    expect(m.server.issuer).toBe("https://app.test");
    expect(m.server.authorization_endpoint).toBe("https://app.test/oauth/authorize");
    expect(m.server.token_endpoint).toBe("https://app.test/oauth/token");
    expect(m.server.registration_endpoint).toBe("https://app.test/oauth/register");
    expect(m.server.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.resource.resource).toBe("https://app.test/api/mcp");
    expect(m.resource.authorization_servers).toEqual(["https://app.test"]);
    expect(ACCESS_TTL_SECONDS).toBe(24 * 3600);
  });
});
