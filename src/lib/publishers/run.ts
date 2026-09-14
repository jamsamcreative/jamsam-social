import { createAdminSupabase } from "@/lib/supabase/admin";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import type { MetaConfig, MetaSecret } from "@/lib/connections/meta";
import type { GbpSecret } from "@/lib/connections/gbp";
import type { Database, MediaItem } from "@/lib/database.types";
import { derivePostStatus, MAX_ATTEMPTS } from "@/lib/posts/status";
import { publishToFacebook } from "./facebook";
import { publishToInstagram } from "./instagram";
import { publishToGbp } from "./gbp";
import type { PublishInput, PublishResult } from "./types";

type Target = Database["public"]["Tables"]["post_targets"]["Row"];
type Post = Database["public"]["Tables"]["posts"]["Row"];
type TargetPatch = Partial<Pick<Target, "status" | "external_id" | "external_url" | "published_at" | "error" | "claimed_at">>;

export type RunDeps = {
  loadPost: (postId: string) => Promise<Post | null>;
  loadMeta: (brandId: string) => Promise<{ config: MetaConfig; secret: MetaSecret } | null>;
  publishFb: (pageId: string, token: string, input: PublishInput) => Promise<PublishResult>;
  publishIg: (igUserId: string, token: string, input: PublishInput) => Promise<PublishResult>;
  loadGbp?: (brandId: string) => Promise<{ secret: GbpSecret } | null>;
  publishGbp?: (locationName: string, refreshToken: string, input: PublishInput) => Promise<PublishResult>;
  save: (targetId: string, patch: TargetPatch) => Promise<void>;
};

export async function processTarget(target: Target, deps: RunDeps): Promise<"published" | "failed" | "retry"> {
  const fail = async (message: string) => {
    const permanent = target.attempts >= MAX_ATTEMPTS;
    await deps.save(target.id, { status: permanent ? "failed" : "pending", error: message, claimed_at: null });
    return permanent ? ("failed" as const) : ("retry" as const);
  };
  try {
    const post = await deps.loadPost(target.post_id);
    if (!post) return fail("Post not found");
    const input: PublishInput = {
      caption: target.caption,
      link_url: post.link_url,
      media: ((post.media as MediaItem[] | null) ?? []).map((m) => ({ url: m.url })),
    };
    let result: PublishResult;
    if (target.platform === "gbp") {
      const gbp = deps.loadGbp ? await deps.loadGbp(post.brand_id) : null;
      if (!gbp || !deps.publishGbp) return fail("Google Business Profile is not connected for this brand");
      if (!target.location_ref) return fail("No Google location on this target");
      result = await deps.publishGbp(target.location_ref, gbp.secret.refresh_token, input);
      await deps.save(target.id, { status: "published", external_id: result.external_id, external_url: result.external_url, published_at: new Date().toISOString(), error: null, claimed_at: null });
      return "published";
    }
    const meta = await deps.loadMeta(post.brand_id);
    if (!meta) return fail("Meta is not connected for this brand");
    if (target.platform === "facebook") {
      result = await deps.publishFb(meta.config.page_id, meta.secret.page_access_token, input);
    } else {
      if (!meta.config.ig_user_id) return fail("No Instagram account is linked to the connected Page");
      result = await deps.publishIg(meta.config.ig_user_id, meta.secret.page_access_token, input);
    }
    await deps.save(target.id, {
      status: "published",
      external_id: result.external_id,
      external_url: result.external_url,
      published_at: new Date().toISOString(),
      error: null,
      claimed_at: null,
    });
    return "published";
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export function realDeps(): RunDeps {
  const admin = createAdminSupabase();
  return {
    loadPost: async (id) => (await admin.from("posts").select("*").eq("id", id).maybeSingle()).data,
    loadMeta: async (brandId) => getConnectionWithSecret<MetaConfig, MetaSecret>(brandId, "meta"),
    publishFb: (p, t, i) => publishToFacebook(p, t, i),
    publishIg: (ig, t, i) => publishToInstagram(ig, t, i),
    loadGbp: async (brandId) => {
      const c = await getConnectionWithSecret<unknown, GbpSecret>(brandId, "gbp");
      return c ? { secret: c.secret } : null;
    },
    publishGbp: (loc, rt, i) => publishToGbp(loc, rt, i),
    save: async (id, patch) => {
      await admin.from("post_targets").update(patch).eq("id", id);
    },
  };
}

export async function syncPostStatus(postId: string) {
  const admin = createAdminSupabase();
  const [{ data: post }, { data: targets }] = await Promise.all([
    admin.from("posts").select("status").eq("id", postId).single(),
    admin.from("post_targets").select("status").eq("post_id", postId),
  ]);
  if (!post || !targets) return;
  const next = derivePostStatus(post.status, targets);
  if (next !== post.status) await admin.from("posts").update({ status: next }).eq("id", postId);
}

export async function runPublishCycle() {
  const admin = createAdminSupabase();
  const { data: resetCount } = await admin.rpc("reset_stale_targets");
  const { data: claimed, error } = await admin.rpc("claim_due_targets", { max_rows: 10 });
  if (error) throw new Error(error.message);
  const deps = realDeps();
  const counts = { reset: resetCount ?? 0, claimed: claimed?.length ?? 0, published: 0, failed: 0, retried: 0 };
  const postIds = new Set<string>();
  for (const t of claimed ?? []) {
    postIds.add(t.post_id);
    await admin.from("posts").update({ status: "publishing" }).eq("id", t.post_id).eq("status", "approved");
    const r = await processTarget(t, deps);
    if (r === "published") counts.published++;
    else if (r === "failed") counts.failed++;
    else counts.retried++;
  }
  for (const id of postIds) await syncPostStatus(id);
  return counts;
}
