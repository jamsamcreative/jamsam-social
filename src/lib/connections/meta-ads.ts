import { z } from "zod";
import type { ConnectionProvider, TestResult } from "./types";
import { errorMessage } from "./http";
import { metaAdAccountInfo, metaAdInsights } from "@/lib/meta/ads";

export const metaAdsConfigSchema = z.object({
  ad_account_id: z.string().trim().regex(/^(act_)?\d+$/, "Ad account ID looks like act_1234567890"),
  ad_account_name: z.string().optional(),
  currency: z.string().optional(),
});
export const metaAdsSecretSchema = z.object({ access_token: z.string().min(1, "Access token is required") });
export type MetaAdsConfig = z.infer<typeof metaAdsConfigSchema>;
export type MetaAdsSecret = z.infer<typeof metaAdsSecretSchema>;

export const metaAds: ConnectionProvider<MetaAdsConfig, MetaAdsSecret> = {
  provider: "meta_ads",
  configSchema: metaAdsConfigSchema,
  secretSchema: metaAdsSecretSchema,
  async test(config, secret, fetchImpl = fetch): Promise<TestResult> {
    try {
      const info = await metaAdAccountInfo(config.ad_account_id, secret.access_token, fetchImpl);
      const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const rows = await metaAdInsights(config.ad_account_id, secret.access_token, { since: day, until: day, level: "account" }, fetchImpl);
      const spend = rows.reduce((s, r) => s + Number(r.spend ?? 0), 0);
      return { ok: true, detail: `${info.name} (${info.currency}): ${info.currency} ${spend.toFixed(2)} spent yesterday.`, configPatch: { ad_account_name: info.name, currency: info.currency } };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },
};
