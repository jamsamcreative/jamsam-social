import { describe, it, expect, vi } from "vitest";
import { fakeStore, job, BRAND } from "@/lib/ai/fake-store";
import { carryPlanToPost } from "@/lib/ai/plan-backstop";
import type { PostSummary } from "@/lib/ai/store";

const postId = "44444444-4444-4444-8444-444444444444";
const plan = { week_start: "2026-09-21", lane: "new_page" as const, reason: "New project page", candidate_id: "project:p1", touched: false };
const captions = { facebook: "Fresh deck in Tacoma", instagram: "Fresh deck in Tacoma #decks" };
const draft = (o: Partial<PostSummary> = {}): PostSummary => ({
  id: postId, brand_id: BRAND.id, title: "Project p1", link_url: null, media: [{ url: "https://x/p1.jpg" }], status: "draft", category_id: null,
  targets: [{ platform: "facebook", caption: "", scheduled_at: "2026-09-21T22:30:00Z" }, { platform: "instagram", caption: "", scheduled_at: "2026-09-22T00:30:00Z" }],
  ...o,
});
const captionJob = (o: Record<string, unknown> = {}) => job({ type: "caption", status: "completed", post_id: postId, input: { post_id: postId, plan: { lane: "new_page", reason: "New project page" }, ...o } });

describe("carryPlanToPost for planner caption jobs", () => {
  it("writes the captions onto the planned draft, sets the category and moves it to pending_approval without touching the plan", async () => {
    const store = fakeStore({ posts: [draft()], categories: [{ id: "c1", name: "Projects", slug: "projects", target_share: 0.5, description: null, sort_order: 0 }] });
    store.plans.set(postId, plan);
    await carryPlanToPost(store, captionJob(), { captions, category_slug: "projects" });
    expect(store.applyCaptionsToPlannedDraft).toHaveBeenCalledWith(postId, { captions, category_slug: "projects" });
    const p = store.posts.find((x) => x.id === postId)!;
    expect(p.status).toBe("pending_approval");
    expect(p.category_id).toBe("c1");
    expect(p.targets.map((t) => [t.platform, t.caption])).toEqual([["facebook", captions.facebook], ["instagram", captions.instagram]]);
    expect(store.plans.get(postId)).toEqual({ ...plan, touched: false });
  });
  it("leaves a draft without a plan alone", async () => {
    const store = fakeStore({ posts: [draft()] });
    await carryPlanToPost(store, captionJob(), { captions });
    const p = store.posts.find((x) => x.id === postId)!;
    expect(p.status).toBe("draft");
    expect(p.targets.every((t) => t.caption === "")).toBe(true);
  });
  it("does nothing for a caption job that did not come from the planner", async () => {
    const store = fakeStore({ posts: [draft()] });
    store.plans.set(postId, plan);
    await carryPlanToPost(store, job({ type: "caption", status: "completed", post_id: postId, input: { post_id: postId } }), { captions });
    expect(store.applyCaptionsToPlannedDraft).not.toHaveBeenCalled();
    expect(store.posts[0].status).toBe("draft");
  });
  it("leaves a post that is already pending_approval untouched", async () => {
    const edited = draft({ status: "pending_approval", targets: [{ platform: "facebook", caption: "Human wrote this", scheduled_at: "2026-09-21T22:30:00Z" }, { platform: "instagram", caption: "And this", scheduled_at: null }] });
    const store = fakeStore({ posts: [edited] });
    store.plans.set(postId, { ...plan, touched: true });
    await carryPlanToPost(store, captionJob(), { captions });
    expect(store.posts[0]).toEqual(edited);
  });
  it("keeps a target caption that already has text and only fills the empty ones", async () => {
    const store = fakeStore({ posts: [draft({ targets: [{ platform: "facebook", caption: "Kept by hand", scheduled_at: "2026-09-21T22:30:00Z" }, { platform: "instagram", caption: "", scheduled_at: null }] })] });
    store.plans.set(postId, plan);
    await carryPlanToPost(store, captionJob(), { captions });
    expect(store.posts[0].status).toBe("pending_approval");
    expect(store.posts[0].targets.map((t) => t.caption)).toEqual(["Kept by hand", captions.instagram]);
  });
  it("never sets approved and never writes approval fields (approval guarantee)", async () => {
    const store = fakeStore({ posts: [draft()] });
    store.plans.set(postId, plan);
    await carryPlanToPost(store, captionJob(), { captions });
    const p = store.posts[0] as PostSummary & { approved_by?: unknown; approved_at?: unknown };
    expect(["draft", "pending_approval"]).toContain(p.status);
    expect(p.approved_by).toBeUndefined();
    expect(p.approved_at).toBeUndefined();
  });
  it("is best-effort: a store failure is logged and swallowed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = fakeStore({ posts: [draft()] });
    store.applyCaptionsToPlannedDraft = vi.fn(async () => { throw new Error("db down"); });
    await expect(carryPlanToPost(store, captionJob(), { captions })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/db down/));
    warn.mockRestore();
  });
});
