import { z } from "zod";
import type { ConnectionProvider, TestResult } from "./types";

// Google Business Profile — connection is established via OAuth (Task 7); this provider only validates config shape.
export const gbpConfigSchema = z.object({
  locations: z.preprocess((v) => (typeof v === "string" ? JSON.parse(v || "[]") : v), z.array(z.object({ name: z.string(), title: z.string(), enabled: z.boolean() })).default([])),
  account_email: z.string().optional(),
});
export const gbpSecretSchema = z.object({ refresh_token: z.string().min(1) });
export type GbpConfig = z.infer<typeof gbpConfigSchema>;
export type GbpSecret = z.infer<typeof gbpSecretSchema>;

export const gbp: ConnectionProvider<GbpConfig, GbpSecret> = {
  provider: "gbp",
  configSchema: gbpConfigSchema,
  secretSchema: gbpSecretSchema,
  async test(config): Promise<TestResult> {
    const on = config.locations.filter((l) => l.enabled).length;
    return { ok: true, detail: `${config.locations.length} location${config.locations.length === 1 ? "" : "s"} available, ${on} enabled for posting.` };
  },
};
