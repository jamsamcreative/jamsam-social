import { z } from "zod";
import type { ConnectionProvider, TestResult } from "./types";
import { fetchWithTimeout, errorMessage } from "./http";

export const PINTEREST_API = "https://api.pinterest.com/v5";

export const pinterestConfigSchema = z.object({
  username: z.string().optional(),
  ad_account_id: z.string().optional(),
});
export const pinterestSecretSchema = z.object({
  access_token: z.string().min(1, "Access token is required"),
  refresh_token: z.string().optional(),
  expires_at: z.string().optional(),
});
export type PinterestConfig = z.infer<typeof pinterestConfigSchema>;
export type PinterestSecret = z.infer<typeof pinterestSecretSchema>;

export const pinterest: ConnectionProvider<PinterestConfig, PinterestSecret> = {
  provider: "pinterest",
  configSchema: pinterestConfigSchema,
  secretSchema: pinterestSecretSchema,
  async test(_config, secret, fetchImpl = fetch): Promise<TestResult> {
    try {
      const res = await fetchWithTimeout(
        `${PINTEREST_API}/user_account`,
        { headers: { Authorization: `Bearer ${secret.access_token}`, Accept: "application/json" } },
        10_000,
        fetchImpl,
      );
      const body = (await res.json()) as { username?: string; account_type?: string; message?: string };
      if (!res.ok) return { ok: false, error: `Pinterest responded ${res.status}: ${body.message ?? "unknown error"}` };
      return { ok: true, detail: `Connected as @${body.username ?? "unknown"} (${body.account_type ?? "unknown type"})` };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },
};
