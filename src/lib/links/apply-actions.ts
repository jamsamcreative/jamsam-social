import { unwrapSnippet, wrapPhrase } from "./apply";
import type { LinksStore } from "./store";

/** The two WordPress calls approve/undo need; `actions.ts` builds it from the brand's connection, tests inject an in-memory map. */
export type WpAdapter = { getRaw(wpId: number): Promise<string>; update(wpId: number, content: string): Promise<void> };
export type ApplyResult = { ok: true; message?: string } | { ok: false; error: string; stale?: boolean };

const STALE = "Post changed since the scan — rescan";
const anchorText = (snippet: string) => snippet.replace(/^<a [^>]*>/, "").replace(/<\/a>$/, "");
const err = (e: unknown): ApplyResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

/**
 * Approve a pending suggestion: wrap the first occurrence of the phrase in the host post's raw content with a link to the orphan's
 * stored url, write it back to WordPress, record `href`/`undo_snippet`/`applied_*` and add the `site_links` edge so the orphan count
 * updates without a rescan. When the phrase is no longer in the post the row is marked `stale` and nothing is written.
 */
export async function approveSuggestion(store: LinksStore, i: { id: string; userId: string; wp: WpAdapter }): Promise<ApplyResult> {
  const s = await store.getSuggestion(i.id);
  if (!s) return { ok: false, error: "Suggestion not found" };
  if (s.status !== "pending") return { ok: false, error: "Only pending suggestions can be approved" };
  if (!s.host_page_id || !s.phrase) return { ok: false, error: "Suggestion has no host or phrase" };
  const [host, orphan] = await Promise.all([store.getPage(s.host_page_id), store.getPage(s.orphan_page_id)]);
  if (!host || !orphan) return { ok: false, error: "The host or orphan page is no longer mirrored — rescan" };
  if (host.type !== "post") return { ok: false, error: "Links are only written into blog posts" }; // the WP write path is /wp/v2/posts
  try {
    const raw = await i.wp.getRaw(host.wp_id);
    const wrapped = wrapPhrase(raw, s.phrase, orphan.url);
    if (!wrapped) {
      await store.setStatus(s.id, { status: "stale" });
      return { ok: false, stale: true, error: STALE };
    }
    await i.wp.update(host.wp_id, wrapped.html);
    await store.setStatus(s.id, { status: "approved", href: orphan.url, undo_snippet: wrapped.snippet, applied_at: new Date().toISOString(), applied_by: i.userId });
    await store.addEdge(s.brand_id, { from_page_id: host.id, to_page_id: orphan.id, href: orphan.url, anchor_text: anchorText(wrapped.snippet) });
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

/**
 * Undo an approved link: replace the stored snippet with its inner text in WordPress, set status `undone` and drop the edge.
 * A snippet that is already gone (removed by hand) is treated as undone without a write.
 */
export async function undoSuggestion(store: LinksStore, i: { id: string; userId: string; wp: WpAdapter }): Promise<ApplyResult> {
  const s = await store.getSuggestion(i.id);
  if (!s) return { ok: false, error: "Suggestion not found" };
  if (s.status !== "approved" || !s.host_page_id || !s.undo_snippet || !s.href) return { ok: false, error: "Only approved links can be undone" };
  const host = await store.getPage(s.host_page_id);
  if (!host) return { ok: false, error: "The host page is no longer mirrored — rescan" };
  try {
    const raw = await i.wp.getRaw(host.wp_id);
    const restored = unwrapSnippet(raw, s.undo_snippet);
    if (restored !== null) await i.wp.update(host.wp_id, restored);
    await store.setStatus(s.id, { status: "undone" });
    await store.removeEdge(s.brand_id, host.id, s.orphan_page_id, s.href);
    return restored === null ? { ok: true, message: "The link was already removed from the post; marked as undone" } : { ok: true };
  } catch (e) {
    return err(e);
  }
}

/** Reject a pending suggestion; the (orphan, host, phrase) triple is never re-proposed by later scans. */
export async function rejectSuggestion(store: LinksStore, i: { id: string }): Promise<ApplyResult> {
  const s = await store.getSuggestion(i.id);
  if (!s) return { ok: false, error: "Suggestion not found" };
  if (s.status !== "pending") return { ok: false, error: "Only pending suggestions can be rejected" };
  try {
    await store.setStatus(s.id, { status: "rejected" });
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}
