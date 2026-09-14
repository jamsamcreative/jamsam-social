// In-memory OauthStore for tests. Never imported by app code.
import type { OauthStore, OauthClient, OauthCode, OauthToken } from "./store";

export function fakeOauthStore(): OauthStore & { clients: OauthClient[]; codes: OauthCode[]; tokens: OauthToken[] } {
  const clients: OauthClient[] = [];
  const codes: OauthCode[] = [];
  const tokens: OauthToken[] = [];
  let n = 0;
  return {
    clients, codes, tokens,
    async createClient(i) { const c = { id: `c${++n}`, created_at: new Date().toISOString(), ...i }; clients.push(c); return c; },
    async getClient(id) { return clients.find((c) => c.client_id === id) ?? null; },
    async createCode(i) { codes.push({ ...i, used_at: null, created_at: new Date().toISOString() }); },
    async consumeCode(h) { const c = codes.find((x) => x.code_hash === h && !x.used_at); if (!c) return null; c.used_at = new Date().toISOString(); return c; },
    async createToken(i) { const t = { id: `t${++n}`, revoked_at: null, last_used_at: null, created_at: new Date().toISOString(), ...i }; tokens.push(t); return t; },
    async getTokenByAccessHash(h) { return tokens.find((t) => t.access_token_hash === h) ?? null; },
    async getTokenByRefreshHash(h) { return tokens.find((t) => t.refresh_token_hash === h) ?? null; },
    async rotateToken(id, p) { Object.assign(tokens.find((t) => t.id === id)!, p); },
    async touchToken(id) { const t = tokens.find((x) => x.id === id); if (t) t.last_used_at = new Date().toISOString(); },
    async revokeToken(id) { const t = tokens.find((x) => x.id === id); if (t) t.revoked_at = new Date().toISOString(); },
    async listTokensForUser(u) { return tokens.filter((t) => t.user_id === u && !t.revoked_at).map((t) => ({ ...t, client_name: clients.find((c) => c.client_id === t.client_id)?.client_name ?? null })); },
  };
}
