import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const ACCESS_TTL_SECONDS = 24 * 3600;
export const REFRESH_TTL_SECONDS = 90 * 24 * 3600;
export const CODE_TTL_SECONDS = 10 * 60;

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) must equal the stored challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

/** Exact-string match against the registered list; only https (or localhost) URIs are ever acceptable. */
export function validateRedirectUri(registered: string[], uri: string): boolean {
  return isAllowedRedirect(uri) && registered.includes(uri);
}

export function isExpired(iso: string): boolean {
  return Date.parse(iso) <= Date.now();
}

export function inSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/** Discovery documents (RFC 8414 + RFC 9728) for an app served at `origin`. */
export function metadata(origin: string) {
  const base = origin.replace(/\/+$/, "");
  return {
    server: {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    },
    resource: {
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
    },
  };
}
