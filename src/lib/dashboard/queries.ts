import { createServerSupabase } from "@/lib/supabase/server";
import type { Brand } from "@/lib/brands/queries";
import { PROVIDER_ORDER } from "@/lib/connections";
import { listConnectionsForBrand, getConnectionWithSecret } from "@/lib/connections/queries";
import type { MetaConfig, MetaSecret } from "@/lib/connections/meta";
import { env } from "@/lib/env";
import { listCategories } from "@/lib/categories/queries";
import { computeContentMix, type ContentMix } from "@/lib/ai/content-mix";
import { createSupabaseStore } from "@/lib/ai/store";
import { createSupabaseLinksStore } from "@/lib/links/store";
import { listImportsForBrand } from "@/lib/seo/queries";
import { dataFreshness } from "@/lib/seo/freshness";
import { listBrands } from "@/lib/brands/queries";
import { summariseNeedsYou, deriveHealthChecks, gscQueue, sortByNeeds, type NeedsYou, type Health } from "./brand-summary";

export type BrandDashboard = {
  needs: NeedsYou;
  health: Health;
  mix: ContentMix;
  gsc: { id: string; title: string; wp_link: string }[];
  freshness: ReturnType<typeof dataFreshness>;
};

export async function getBrandDashboard(brand: Brand): Promise<BrandDashboard> {
  const supabase = await createServerSupabase();
  const now = new Date();
  const [posts, targets, pins, jobs, links, connections, meta, syncRuns, articles, categories, recent, imports] = await Promise.all([
    supabase.from("posts").select("status").eq("brand_id", brand.id).neq("status", "archived"),
    supabase.from("post_targets").select("status,scheduled_at,published_at,post:posts!inner(brand_id,status)").eq("post.brand_id", brand.id),
    supabase.from("pins").select("status,scheduled_at,published_at").eq("brand_id", brand.id).neq("status", "archived"),
    supabase.from("generation_jobs").select("status,runner").eq("brand_id", brand.id).in("status", ["queued", "claimed", "running", "failed"]),
    createSupabaseLinksStore().counts(brand.id),
    listConnectionsForBrand(brand.id),
    getConnectionWithSecret<MetaConfig, MetaSecret>(brand.id, "meta").catch(() => null),
    supabase.from("sync_runs").select("source,last_ok_at,last_error").eq("brand_id", brand.id),
    supabase.from("articles").select("id,title,status,wp_link,pushed_at,gsc_submitted_at").eq("brand_id", brand.id).in("status", ["pushed_to_wp", "published"]),
    listCategories(brand.id),
    createSupabaseStore().listRecentCategorizedPosts(brand.id),
    listImportsForBrand(brand.id),
  ]);
  for (const r of [posts, targets, pins, jobs, syncRuns, articles]) if (r.error) throw new Error(r.error.message);

  type TargetRow = { status: string; scheduled_at: string | null; published_at: string | null; post: { brand_id: string; status: string } };
  const targetRows = (targets.data ?? []) as unknown as TargetRow[];
  const failingConnections = connections.filter((c) => c.status === "failing").length;

  const needs = summariseNeedsYou(
    {
      posts: posts.data ?? [],
      targets: targetRows.map((t) => ({ status: t.status, scheduled_at: t.scheduled_at, post_status: t.post.status })),
      pins: pins.data ?? [],
      jobs: jobs.data ?? [],
      pendingLinks: links.pending,
      failingConnections,
    },
    now,
  );

  const publishedAts = [...targetRows.map((t) => t.published_at), ...(pins.data ?? []).map((p) => p.published_at)].filter((x): x is string => Boolean(x)).sort();
  const health = deriveHealthChecks(
    {
      slug: brand.slug,
      providers: [...PROVIDER_ORDER, ...(env.GBP_ENABLED === "true" ? (["gbp"] as const) : [])],
      connections,
      metaExpiresAt: meta?.secret.expires_at ?? null,
      overdue: needs.attention.overdue,
      lastPublishedAt: publishedAts.at(-1) ?? null,
      syncRuns: syncRuns.data ?? [],
    },
    now,
  );

  const mix = computeContentMix(categories, recent);
  const gsc = gscQueue(articles.data ?? []).map((a) => ({ id: a.id, title: a.title, wp_link: a.wp_link! }));

  return { needs, health, mix, gsc, freshness: dataFreshness(imports, now) };
}

export type BrandOverview = Pick<Brand, "id" | "slug" | "name" | "website_url"> & { needs: NeedsYou; failingConnections: number };

/** The all-brands overview: just the Needs-you inputs per brand (a subset of getBrandDashboard's reads). */
export async function listBrandOverviews(): Promise<BrandOverview[]> {
  const supabase = await createServerSupabase();
  const now = new Date();
  const brands = await listBrands();
  const rows = await Promise.all(
    brands.map(async (brand) => {
      const [posts, targets, pins, jobs, links, connections] = await Promise.all([
        supabase.from("posts").select("status").eq("brand_id", brand.id).neq("status", "archived"),
        supabase.from("post_targets").select("status,scheduled_at,post:posts!inner(brand_id,status)").eq("post.brand_id", brand.id),
        supabase.from("pins").select("status,scheduled_at").eq("brand_id", brand.id).neq("status", "archived"),
        supabase.from("generation_jobs").select("status,runner").eq("brand_id", brand.id).in("status", ["queued", "claimed", "running", "failed"]),
        createSupabaseLinksStore().counts(brand.id),
        listConnectionsForBrand(brand.id),
      ]);
      for (const r of [posts, targets, pins, jobs]) if (r.error) throw new Error(r.error.message);
      type TargetRow = { status: string; scheduled_at: string | null; post: { brand_id: string; status: string } };
      const targetRows = (targets.data ?? []) as unknown as TargetRow[];
      const failingConnections = connections.filter((c) => c.status === "failing").length;
      const needs = summariseNeedsYou(
        {
          posts: posts.data ?? [],
          targets: targetRows.map((t) => ({ status: t.status, scheduled_at: t.scheduled_at, post_status: t.post.status })),
          pins: pins.data ?? [],
          jobs: jobs.data ?? [],
          pendingLinks: links.pending,
          failingConnections,
        },
        now,
      );
      return { id: brand.id, slug: brand.slug, name: brand.name, website_url: brand.website_url, needs, failingConnections };
    }),
  );
  return sortByNeeds(rows);
}
