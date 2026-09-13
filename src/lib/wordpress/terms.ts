import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import type { WordpressConfig, WordpressSecret } from "@/lib/connections/wordpress-shared";
import type { Json, TermRef } from "@/lib/database.types";
import { createWpClient, listTerms } from "./client";

export type WpTerms = { categories: TermRef[]; tags: TermRef[]; fetched_at: string };
const TTL_MS = 24 * 60 * 60 * 1000;

/** Categories and tags for a brand's WordPress, cached on the connection config. Returns null when WP is not connected. */
export async function getWpTerms(brandId: string, opts: { refresh?: boolean } = {}): Promise<WpTerms | null> {
  const conn = await getConnectionWithSecret<WordpressConfig & { wp_terms?: WpTerms }, WordpressSecret>(brandId, "wordpress");
  if (!conn) return null;
  const cached = conn.config.wp_terms;
  if (!opts.refresh && cached && Date.now() - new Date(cached.fetched_at).getTime() < TTL_MS) return cached;
  const client = createWpClient(conn.config, conn.secret);
  const [categories, tags] = await Promise.all([listTerms(client, "categories"), listTerms(client, "tags")]);
  const terms: WpTerms = { categories, tags, fetched_at: new Date().toISOString() };
  const admin = createAdminSupabase();
  await admin
    .from("brand_connections")
    .update({ config: { ...conn.config, wp_terms: terms } as unknown as Json })
    .eq("id", conn.id);
  return terms;
}
