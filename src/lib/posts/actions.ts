"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { parsePostForm } from "./schema";
import { validateForSubmit, PLATFORMS } from "./status";
import { zonedLocalToUtc } from "@/lib/time/zoned";
import type { Json } from "@/lib/database.types";
import type { Post, PostTarget } from "./queries";
import { env } from "@/lib/env";
import { getConnectionWithSecret } from "@/lib/connections/queries";
import type { GbpConfig } from "@/lib/connections/gbp";
import { createSupabasePlanStore } from "@/lib/plan/store";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

async function ctx() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

type Loaded =
  | { error: string; supabase?: undefined; user?: undefined; post?: undefined }
  | { error?: undefined; supabase: Awaited<ReturnType<typeof createServerSupabase>>; user: { id: string }; post: Post & { targets: PostTarget[] } };

async function loadPostForAction(id: string): Promise<Loaded> {
  const { supabase, user } = await ctx();
  if (!user) return { error: "Not signed in" };
  const { data } = await supabase.from("posts").select("*, targets:post_targets(*)").eq("id", id).maybeSingle();
  if (!data) return { error: "Post not found" };
  const post = data as unknown as Post & { targets: PostTarget[] };
  return { supabase, user, post };
}

function refresh() {
  revalidatePath("/posts", "layout");
  revalidatePath("/calendar");
  revalidatePath("/brands/[slug]", "page");
}

export async function savePost(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = parsePostForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid post" };
  const input = parsed.data;
  const { data: brand } = await supabase.from("brands").select("timezone").eq("id", input.brand_id).single();
  if (!brand) return { ok: false, error: "Brand not found" };

  let id = input.id;
  if (id) {
    const { data: existing } = await supabase.from("posts").select("status").eq("id", id).single();
    if (!existing) return { ok: false, error: "Post not found" };
    if (["publishing", "published"].includes(existing.status)) return { ok: false, error: "Published posts cannot be edited. Recycle it instead." };
    // Editing anything approved or pending drops it back to draft for re-review.
    const { error } = await supabase
      .from("posts")
      .update({ title: input.title, link_url: input.link_url, media: input.media as Json, category_id: input.category_id, status: "draft" })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await supabase
      .from("posts")
      .insert({ brand_id: input.brand_id, title: input.title, link_url: input.link_url, media: input.media as Json, category_id: input.category_id, created_by: user.id })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not create post" };
    id = data.id;
  }

  for (const t of input.targets) {
    const scheduled_at = t.scheduled_local ? zonedLocalToUtc(t.scheduled_local, brand.timezone) : null;
    if (t.enabled) {
      const { error } = await supabase
        .from("post_targets")
        .upsert({ post_id: id, platform: t.platform, location_ref: "", caption: t.caption, scheduled_at, status: "pending", error: null }, { onConflict: "post_id,platform,location_ref" });
      if (error) return { ok: false, error: error.message };
    } else {
      await supabase.from("post_targets").delete().eq("post_id", id).eq("platform", t.platform).neq("status", "published");
    }
  }
  // Planned posts edited by hand survive a plan rebuild; no-op for posts without `plan`.
  await createSupabasePlanStore().markTouched(id);
  refresh();
  return { ok: true, id };
}

export async function submitForApproval(id: string): Promise<ActionResult> {
  const r = await loadPostForAction(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (r.post.status !== "draft") return { ok: false, error: "Only drafts can be submitted" };
  const media = (r.post.media as unknown[]) ?? [];
  const msg = validateForSubmit({
    media,
    targets: PLATFORMS.map((p) => {
      const t = r.post.targets.find((x) => x.platform === p);
      return { platform: p, enabled: Boolean(t), caption: t?.caption ?? "", scheduled_at: t?.scheduled_at ?? null };
    }),
  });
  if (msg) return { ok: false, error: msg };
  await r.supabase.from("posts").update({ status: "pending_approval" }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function approvePost(id: string): Promise<ActionResult> {
  const r = await loadPostForAction(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (r.post.status !== "pending_approval") return { ok: false, error: "Post is not awaiting approval" };
  await r.supabase.from("posts").update({ status: "approved", approved_by: r.user.id, approved_at: new Date().toISOString() }).eq("id", id);
  await addGbpTargets(r.post, r.supabase);
  refresh();
  return { ok: true };
}

/** Feature-flagged: approved posts also go out as Google Business Profile posts, one target per enabled location, mirroring the Facebook schedule. */
async function addGbpTargets(post: Post & { targets: PostTarget[] }, supabase: Awaited<ReturnType<typeof createServerSupabase>>) {
  if (env.GBP_ENABLED !== "true") return;
  const gbp = await getConnectionWithSecret<GbpConfig, unknown>(post.brand_id, "gbp");
  const fb = post.targets.find((t) => t.platform === "facebook");
  if (!gbp || !fb) return;
  const existing = new Set(post.targets.filter((t) => t.platform === "gbp").map((t) => t.location_ref));
  const rows = (gbp.config.locations ?? []).filter((l) => l.enabled && !existing.has(l.name)).map((l) => ({ post_id: post.id, platform: "gbp" as const, caption: fb.caption, scheduled_at: fb.scheduled_at, location_ref: l.name }));
  if (rows.length) await supabase.from("post_targets").insert(rows);
}

export async function rejectPost(id: string): Promise<ActionResult> {
  const r = await loadPostForAction(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (r.post.status !== "pending_approval") return { ok: false, error: "Post is not awaiting approval" };
  await r.supabase.from("posts").update({ status: "draft" }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function publishNow(id: string): Promise<ActionResult> {
  const r = await loadPostForAction(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (!["draft", "pending_approval", "approved", "failed"].includes(r.post.status)) return { ok: false, error: "Post cannot be published from its current state" };
  const media = (r.post.media as unknown[]) ?? [];
  const msg = validateForSubmit({
    media,
    targets: r.post.targets.map((t) => ({ platform: t.platform, enabled: t.status !== "published", caption: t.caption, scheduled_at: "now" })),
  });
  if (msg) return { ok: false, error: msg };
  const now = new Date().toISOString();
  await r.supabase.from("post_targets").update({ scheduled_at: now, status: "pending", error: null, attempts: 0 }).eq("post_id", id).neq("status", "published");
  await r.supabase.from("posts").update({ status: "approved", approved_by: r.user.id, approved_at: now }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function recyclePost(id: string): Promise<ActionResult> {
  const r = await loadPostForAction(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  const { data: created, error } = await r.supabase
    .from("posts")
    .insert({
      brand_id: r.post.brand_id,
      title: `Re-run: ${r.post.title.replace(/^Re-run: /, "")}`,
      link_url: r.post.link_url,
      media: r.post.media,
      source: "recycled",
      recycled_from: r.post.id,
      created_by: r.user.id,
    })
    .select("id")
    .single();
  if (error || !created?.id) return { ok: false, error: error?.message ?? "Could not recycle" };
  const newId: string = created.id;
  if (r.post.targets.length) {
    await r.supabase.from("post_targets").insert(r.post.targets.map((t) => ({ post_id: newId, platform: t.platform, caption: t.caption })));
  }
  refresh();
  redirect(`/posts/${newId}`);
}

export async function archivePost(id: string): Promise<ActionResult> {
  const r = await loadPostForAction(id);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (r.post.status === "publishing") return { ok: false, error: "Wait for publishing to finish" };
  await r.supabase.from("posts").update({ status: "archived" }).eq("id", id);
  refresh();
  return { ok: true };
}

export async function retryTarget(targetId: string): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data: t } = await supabase.from("post_targets").select("id,post_id,status").eq("id", targetId).single();
  if (!t || t.status !== "failed") return { ok: false, error: "Only failed targets can be retried" };
  await supabase.from("post_targets").update({ status: "pending", attempts: 0, error: null, scheduled_at: new Date().toISOString() }).eq("id", targetId);
  await supabase.from("posts").update({ status: "approved" }).eq("id", t.post_id);
  refresh();
  return { ok: true };
}

export async function rescheduleTarget(targetId: string, newIso: string): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data: t } = await supabase.from("post_targets").select("id,post_id,status,post:posts(status)").eq("id", targetId).single();
  if (!t || t.status !== "pending") return { ok: false, error: "Only unpublished targets can be moved" };
  const postStatus = (t.post as unknown as { status: string } | null)?.status;
  if (postStatus === "publishing") return { ok: false, error: "Post is publishing" };
  await supabase.from("post_targets").update({ scheduled_at: newIso }).eq("id", targetId);
  await createSupabasePlanStore().markTouched(t.post_id);
  refresh();
  return { ok: true };
}
