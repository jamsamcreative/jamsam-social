import { describe, it, expect, vi } from "vitest";
import type { WpClient } from "@/lib/wordpress/client";
import { wpAdapterFor, ALTERED_ON_SAVE } from "./wp-adapter";

type Fake = WpClient & { post: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
/** A WpClient whose get/post are vi.fn mocks; `over` swaps the mocks' responses. */
function fakeClient(over: { get?: () => Promise<unknown>; post?: () => Promise<unknown> } = {}): Fake {
  const get = vi.fn(over.get ?? (async () => ({ data: { id: 7, content: { raw: "<p>raw</p>" } }, headers: new Headers() })));
  const post = vi.fn(over.post ?? (async (_path: string, body: unknown) => ({ id: 7, content: { raw: (body as { content: string }).content } })));
  return { siteUrl: "https://acme.com", get, post } as unknown as Fake;
}

describe("wpAdapterFor", () => {
  it("getRaw reads the post with context=edit and returns content.raw", async () => {
    const client = fakeClient();
    expect(await wpAdapterFor(client).getRaw(7)).toBe("<p>raw</p>");
    expect(client.get).toHaveBeenCalledWith("/wp/v2/posts/7", { context: "edit", _fields: "id,content" });
  });
  it("getRaw fails loudly when WordPress returns no raw content", async () => {
    const client = fakeClient({ get: async () => ({ data: { id: 7 }, headers: new Headers() }) });
    await expect(wpAdapterFor(client).getRaw(7)).rejects.toThrow("WordPress did not return the post content");
  });
  it("update posts the content asking for the raw content back, and resolves when WordPress kept it verbatim", async () => {
    const client = fakeClient();
    await expect(wpAdapterFor(client).update(7, `<p>a <a href="/x">b</a></p>`)).resolves.toBeUndefined();
    expect(client.post).toHaveBeenCalledWith("/wp/v2/posts/7?_fields=id,content&context=edit", { content: `<p>a <a href="/x">b</a></p>` });
  });
  it("update throws the unfiltered_html error when WordPress saved something different from what was sent", async () => {
    const client = fakeClient({ post: async () => ({ id: 7, content: { raw: `<p>a <a href="/x">b</a></p>` } }) });
    await expect(wpAdapterFor(client).update(7, `<p>a <a href="/x">b</a></p><iframe src="https://y"></iframe>`)).rejects.toThrow(ALTERED_ON_SAVE);
  });
  it("update throws the same error when the response carries no raw content to compare", async () => {
    const client = fakeClient({ post: async () => ({ id: 7 }) });
    await expect(wpAdapterFor(client).update(7, "<p>x</p>")).rejects.toThrow(ALTERED_ON_SAVE);
  });
});
