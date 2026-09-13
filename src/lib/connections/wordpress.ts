import type { ConnectionProvider, TestResult } from "./types";
import { fetchWithTimeout, errorMessage } from "./http";
import { wordpressConfigSchema, wordpressSecretSchema, wpAuthHeader, wpBase, type WordpressConfig, type WordpressSecret } from "./wordpress-shared";
import { checkHelper, createWpClient } from "@/lib/wordpress/client";

export { wordpressConfigSchema, wordpressSecretSchema, wpAuthHeader, wpBase };
export type { WordpressConfig, WordpressSecret };

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
      const helper = await checkHelper(createWpClient(config, secret, fetchImpl));
      const helperNote = helper.installed ? "JamSam helper: installed" : "JamSam helper: not installed (SEO fields will be skipped)";
      return { ok: true, detail: `Signed in as ${body.name ?? config.username} (${(body.roles ?? []).join(", ") || "unknown role"}). ${helperNote}` };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },
};
