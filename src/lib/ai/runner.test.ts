import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runJobWith } from "@/lib/ai/runner";
import { fakeStore, job, BRAND } from "@/lib/ai/fake-store";

const post = { id: "44444444-4444-4444-8444-444444444444", brand_id: BRAND.id, title: "New deck", link_url: null, media: [], status: "draft" as const, category_id: null, targets: [] };
const good = "We're on site and it's looking great 🔥";

type Turn = { tool?: { name: string; input: unknown }; text?: string };
/** Each call to messages.stream() consumes the next scripted turn. */
function fakeClient(turns: Turn[]) {
  let n = 0;
  const calls: unknown[] = [];
  const stream = vi.fn((params: unknown) => {
    calls.push(params);
    const t = turns[n++] ?? { text: "done" };
    const content = t.tool ? [{ type: "tool_use", id: `tu${n}`, name: t.tool.name, input: t.tool.input }] : [{ type: "text", text: t.text }];
    const message = { content, stop_reason: t.tool ? "tool_use" : "end_turn", usage: { input_tokens: 100, output_tokens: 50 } };
    return { finalMessage: async () => message };
  });
  return { client: { messages: { stream } } as unknown as Pick<Anthropic, "messages">, calls };
}

describe("runJobWith", () => {
  it("runs lookups, retries after a validation error, completes on the terminal tool", async () => {
    const store = fakeStore({ jobs: [job()], posts: [post] });
    const { client, calls } = fakeClient([
      { tool: { name: "get_content_mix", input: { brand: "acme" } } },
      { tool: { name: "submit_captions", input: { job_id: store.jobs[0].id, captions: { facebook: "Actually — no", instagram: good } } } },
      { tool: { name: "submit_captions", input: { job_id: store.jobs[0].id, captions: { facebook: good, instagram: good } } } },
    ]);
    expect(await runJobWith(store.jobs[0].id, { store, client, model: "claude-opus-5" })).toBe("completed");
    expect(store.jobs[0]).toMatchObject({ status: "completed", attempts: 1, model: "claude-opus-5", input_tokens: 300, output_tokens: 150, result: { captions: { facebook: good, instagram: good } } });
    // The rejected call was fed back as an error tool_result (messages is shared across calls, so scan the transcript)
    type Block = { type: string; is_error?: boolean; content?: string };
    const transcript = (calls[2] as { messages: { content: Block[] | string }[] }).messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    const errorResult = transcript.find((b) => b.type === "tool_result" && b.is_error);
    expect(errorResult?.content).toMatch(/em dash/);
    expect((calls[0] as { system: string }).system).toMatch(/Be upbeat\./);
  });
  it("keeps a promo job completed when the plan backstop write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const article = { id: "66666666-6666-4666-8666-666666666666", brand_id: BRAND.id, title: "A", slug: "a", status: "published" as const, url: "https://acme.com/a", primary_keyword: null, wp_link: null, content_html: "<p>a</p>", excerpt: null, featured_media: null, published_at: "2026-09-01T00:00:00Z" };
    const plan = { week_start: "2026-09-21", lane: "promo", reason: "New article", candidate_id: `article:${article.id}`, touched: false };
    const store = fakeStore({ jobs: [job({ type: "promo", input: { article_id: article.id, plan } })], articles: [article] });
    store.setPostPlanIfMissing = vi.fn(async () => { throw new Error("db down"); });
    const { client } = fakeClient([{ tool: { name: "create_post", input: { brand: "acme", title: "Promo", targets: [{ platform: "facebook", caption: good }], media_urls: [], article_id: article.id } } }]);
    expect(await runJobWith(store.jobs[0].id, { store, client, model: "m" })).toBe("completed");
    expect(store.jobs[0]).toMatchObject({ status: "completed", error: null, result: { post_id: "11111111-1111-4111-8111-111111111111" } });
    expect(store.setPostPlanIfMissing).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("skips a job that is not queued", async () => {
    const store = fakeStore({ jobs: [job({ status: "completed" })] });
    const { client } = fakeClient([]);
    expect(await runJobWith(store.jobs[0].id, { store, client, model: "m" })).toBe("skipped");
  });
  it("fails after maxTurns without a terminal tool and leaves no partial records", async () => {
    const store = fakeStore({ jobs: [job()], posts: [post] });
    const { client } = fakeClient(Array(5).fill({ tool: { name: "get_content_mix", input: { brand: "acme" } } }));
    expect(await runJobWith(store.jobs[0].id, { store, client, model: "m", maxTurns: 3 })).toBe("failed");
    expect(store.jobs[0].error).toMatch(/3 turns/);
    expect(store.created.posts).toHaveLength(0);
  });
  it("fails when the model ends its turn without calling the terminal tool", async () => {
    const store = fakeStore({ jobs: [job()], posts: [post] });
    const { client } = fakeClient([{ text: "Here are your captions: ..." }]);
    expect(await runJobWith(store.jobs[0].id, { store, client, model: "m" })).toBe("failed");
    expect(store.jobs[0].error).toMatch(/without calling submit_captions/);
  });
  it("retries transient API errors then fails", async () => {
    const store = fakeStore({ jobs: [job()], posts: [post] });
    const stream = vi.fn(() => {
      throw Object.assign(new Error("overloaded"), { status: 529 });
    });
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    expect(await runJobWith(store.jobs[0].id, { store, client, model: "m", sleep: async () => {} })).toBe("failed");
    expect(stream).toHaveBeenCalledTimes(3);
    expect(store.jobs[0].error).toMatch(/overloaded/);
  });
  it("article jobs complete on create_article and record article_id", async () => {
    const store = fakeStore({ jobs: [job({ type: "article", input: { topic: "Deck staining", decision: "new", secondary_keywords: [] } })] });
    const { client } = fakeClient([
      { tool: { name: "create_article", input: { brand: "acme", title: "Deck Staining", slug: "deck-staining", content_html: "<p>x</p>", featured_media_url: "https://cdn/x.jpg", featured_alt: "deck", decision: "new" } } },
    ]);
    expect(await runJobWith(store.jobs[0].id, { store, client, model: "m" })).toBe("completed");
    expect(store.jobs[0]).toMatchObject({ status: "completed", article_id: "22222222-2222-4222-8222-222222222222", result: { article_id: "22222222-2222-4222-8222-222222222222" } });
  });
});
