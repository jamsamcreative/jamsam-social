import { z } from "zod";
import type { ConnectionProvider, TestResult } from "./types";
import { fetchWithTimeout, errorMessage } from "./http";

export const META_GRAPH = "https://graph.facebook.com/v21.0";

export const metaConfigSchema = z.object({
  page_id: z.string().min(1, "Facebook Page ID is required"),
  page_name: z.string().optional(),
  ig_user_id: z.string().optional(),
  ig_username: z.string().optional(),
});
export const metaSecretSchema = z.object({
  page_access_token: z.string().min(1, "Page access token is required"),
  expires_at: z.string().optional(),
});
export type MetaConfig = z.infer<typeof metaConfigSchema>;
export type MetaSecret = z.infer<typeof metaSecretSchema>;

type PageInfo = { name?: string; instagram_business_account?: { id: string; username?: string }; error?: { message?: string } };

async function fetchPage(config: MetaConfig, secret: MetaSecret, fetchImpl: typeof fetch) {
  const url = new URL(`${META_GRAPH}/${config.page_id}`);
  url.searchParams.set("fields", "name,instagram_business_account{id,username}");
  url.searchParams.set("access_token", secret.page_access_token);
  const res = await fetchWithTimeout(url, {}, 10_000, fetchImpl);
  const body = (await res.json()) as PageInfo;
  return { res, body };
}

export const meta: ConnectionProvider<MetaConfig, MetaSecret> = {
  provider: "meta",
  configSchema: metaConfigSchema,
  secretSchema: metaSecretSchema,
  async test(config, secret, fetchImpl = fetch): Promise<TestResult> {
    try {
      const { res, body } = await fetchPage(config, secret, fetchImpl);
      if (!res.ok) return { ok: false, error: `Meta responded ${res.status}: ${body.error?.message ?? "unknown error"}` };
      const ig = body.instagram_business_account;
      return { ok: true, detail: `Page: ${body.name ?? config.page_id}. Instagram: ${ig?.username ? `@${ig.username}` : "not linked"}` };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },
};

/** After a successful test, copy the discovered names/ids back into config so the UI can show them. */
export async function enrichMetaConfig(config: MetaConfig, secret: MetaSecret, fetchImpl: typeof fetch = fetch): Promise<MetaConfig> {
  try {
    const { res, body } = await fetchPage(config, secret, fetchImpl);
    if (!res.ok) return config;
    return {
      ...config,
      page_name: body.name ?? config.page_name,
      ig_user_id: body.instagram_business_account?.id ?? config.ig_user_id,
      ig_username: body.instagram_business_account?.username ?? config.ig_username,
    };
  } catch {
    return config;
  }
}
