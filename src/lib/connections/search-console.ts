import { z } from "zod";
import type { ConnectionProvider, TestResult } from "./types";
import { errorMessage } from "./http";
import { serviceAccount, googleAccessToken, GSC_SCOPE } from "@/lib/google/auth";
import { gscQuery } from "@/lib/google/gsc";
import { GoogleApiError } from "@/lib/google/api";

export const gscConfigSchema = z.object({
  site_url: z
    .string()
    .trim()
    .min(1, "Site URL is required")
    .refine((v) => v.startsWith("sc-domain:") || /^https?:\/\/.+\/$/.test(v), "Use sc-domain:client.com (domain property) or https://client.com/ (URL-prefix property, trailing slash)"),
});
export const gscSecretSchema = z.object({});
export type GscConfig = z.infer<typeof gscConfigSchema>;

export const searchConsole: ConnectionProvider<GscConfig, Record<string, never>> = {
  provider: "search_console",
  configSchema: gscConfigSchema,
  secretSchema: gscSecretSchema as z.ZodType<Record<string, never>>,
  async test(config, _secret, fetchImpl = fetch): Promise<TestResult> {
    const sa = serviceAccount();
    if (!sa) return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON is not configured on the server" };
    try {
      const token = await googleAccessToken([GSC_SCOPE]);
      const end = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
      const start = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
      const r = await gscQuery(config.site_url, { startDate: start, endDate: end, dimensions: ["date"] }, { token, fetchImpl });
      const clicks = r.rows.reduce((s, x) => s + x.clicks, 0);
      const imps = r.rows.reduce((s, x) => s + x.impressions, 0);
      return { ok: true, detail: `${config.site_url}: ${clicks} clicks / ${imps} impressions over the last week (Search Console data lags ~3 days).` };
    } catch (e) {
      if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
        return { ok: false, error: `Google denied access to ${config.site_url}. In Search Console → Settings → Users and permissions, add ${sa.email} (Full or Restricted).` };
      }
      return { ok: false, error: errorMessage(e) };
    }
  },
};
