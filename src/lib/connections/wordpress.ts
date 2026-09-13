import { z } from "zod";
import type { ConnectionProvider, TestResult } from "./types";
import { fetchWithTimeout, errorMessage } from "./http";

export const wordpressConfigSchema = z.object({
  site_url: z.string().url("Enter the site URL, e.g. https://client.com"),
  username: z.string().min(1, "Username is required"),
});
export const wordpressSecretSchema = z.object({
  app_password: z.string().min(1, "Application password is required"),
});
export type WordpressConfig = z.infer<typeof wordpressConfigSchema>;
export type WordpressSecret = z.infer<typeof wordpressSecretSchema>;

export function wpBase(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

export function wpAuthHeader(username: string, appPassword: string): string {
  return "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");
}

/** Parse a WP REST response body; returns null when it is not JSON (e.g. an HTML page). */
async function readJson<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export const wordpress: ConnectionProvider<WordpressConfig, WordpressSecret> = {
  provider: "wordpress",
  configSchema: wordpressConfigSchema,
  secretSchema: wordpressSecretSchema,
  async test(config, secret, fetchImpl = fetch): Promise<TestResult> {
    try {
      const res = await fetchWithTimeout(
        `${wpBase(config.site_url)}/wp-json/wp/v2/users/me?context=edit`,
        { headers: { Authorization: wpAuthHeader(config.username, secret.app_password), Accept: "application/json" } },
        10_000,
        fetchImpl,
      );
      const body = await readJson<{ name?: string; roles?: string[]; message?: string }>(res);
      if (!res.ok) {
        const msg = body?.message ?? "";
        return { ok: false, error: `WordPress responded ${res.status}${msg ? `: ${msg}` : ""}` };
      }
      if (!body) {
        const ct = res.headers.get("content-type")?.split(";")[0] ?? "unknown content type";
        return { ok: false, error: `WordPress did not return JSON (got ${ct}). Check the site URL and that the REST API is enabled.` };
      }
      return { ok: true, detail: `Signed in as ${body.name ?? config.username} (${(body.roles ?? []).join(", ") || "unknown role"})` };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },
};
