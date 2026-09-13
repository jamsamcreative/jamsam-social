import { z } from "zod";
import type { ConnectionProvider, TestResult } from "./types";
import { fetchWithTimeout, errorMessage } from "./http";

export const semrushConfigSchema = z.object({
  database: z.string().min(2).default("us"),
});
export const semrushSecretSchema = z.object({
  api_key: z.string().min(1, "API key is required"),
});
export type SemrushConfig = z.infer<typeof semrushConfigSchema>;
export type SemrushSecret = z.infer<typeof semrushSecretSchema>;

export const semrush: ConnectionProvider<SemrushConfig, SemrushSecret> = {
  provider: "semrush",
  configSchema: semrushConfigSchema,
  secretSchema: semrushSecretSchema,
  async test(_config, secret, fetchImpl = fetch): Promise<TestResult> {
    try {
      // countapiunits is free: it does not consume units and validates the key.
      const res = await fetchWithTimeout(
        `https://www.semrush.com/users/countapiunits.html?key=${encodeURIComponent(secret.api_key)}`,
        {},
        10_000,
        fetchImpl,
      );
      const text = (await res.text()).trim();
      if (!res.ok) return { ok: false, error: `SEMrush responded ${res.status}` };
      if (text.startsWith("ERROR")) return { ok: false, error: `SEMrush: ${text}` };
      const units = Number(text);
      if (!Number.isFinite(units)) return { ok: false, error: `SEMrush returned an unexpected response: ${text.slice(0, 80)}` };
      return { ok: true, detail: `${units.toLocaleString("en-US")} API units remaining` };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },
};
