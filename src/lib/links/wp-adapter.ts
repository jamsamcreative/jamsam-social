import type { WpClient } from "@/lib/wordpress/client";
import type { WpAdapter } from "./apply-actions";

export const ALTERED_ON_SAVE =
  "WordPress altered the post while saving (the connected user may lack unfiltered_html). The link was written — check the post in WordPress and use an Administrator app password.";

/**
 * The two WordPress calls approve/undo need over a `WpClient`: raw post content (`context=edit`) and a content-only update.
 * The update asks WordPress for the saved raw content back and fails when it differs from what was sent — a user without
 * `unfiltered_html` has the whole post run through wp_kses, which silently strips iframes, scripts and similar markup.
 */
export function wpAdapterFor(client: WpClient): WpAdapter {
  return {
    async getRaw(wpId) {
      const { data } = await client.get<{ content?: { raw?: unknown } }>(`/wp/v2/posts/${wpId}`, { context: "edit", _fields: "id,content" });
      if (typeof data?.content?.raw !== "string") throw new Error("WordPress did not return the post content");
      return data.content.raw;
    },
    async update(wpId, content) {
      const saved = await client.post<{ content?: { raw?: unknown } }>(`/wp/v2/posts/${wpId}?_fields=id,content&context=edit`, { content });
      if (saved?.content?.raw !== content) throw new Error(ALTERED_ON_SAVE);
    },
  };
}
