"use server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createSupabaseStore } from "@/lib/ai/store";
import { runCannibalizationCheck } from "@/lib/ai/tools/seo";
import { suggestInternalLinks } from "./links";
import type { CannibalizationResult } from "./cannibalization";

export type EditorHints = { check: CannibalizationResult; links: { title: string; url: string; slug: string }[] };

/** Live editor hints: cannibalization verdict for the keyword/slug (ignoring the article itself) and internal-link candidates. */
export async function editorHints(brandId: string, articleId: string | null, keyword: string, slug: string, title: string): Promise<EditorHints | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !keyword.trim()) return null;
  const store = createSupabaseStore();
  const ctx = { store, actor: { kind: "in_app" as const, userId: user.id } };
  const pages = await store.listSitePages(brandId);
  const check = await runCannibalizationCheck(ctx, brandId, keyword, slug || undefined);
  // The article being edited is not a conflict with itself.
  if (articleId) {
    check.conflicts.articles_with_same_primary_keyword = check.conflicts.articles_with_same_primary_keyword.filter((a) => a.id !== articleId);
    check.conflicts.articles_with_same_slug = check.conflicts.articles_with_same_slug.filter((a) => a.id !== articleId);
    check.has_conflict = check.conflicts.articles_with_same_primary_keyword.length > 0 || check.conflicts.articles_with_same_slug.length > 0 || Boolean(check.conflicts.live_page_using_this_slug) || Boolean(check.conflicts.live_page_on_this_topic) || Boolean(check.conflicts.page_already_ranking);
    if (!check.has_conflict) check.verdict = `CLEAR — nothing else targets "${check.keyword}".`;
  }
  const links = suggestInternalLinks(keyword, title, pages.map((p) => ({ slug: p.slug, url: p.url, title: p.title, type: p.type, focus_keyword: p.focus_keyword }))).map((l) => ({ title: l.title, url: l.url, slug: l.slug }));
  return { check, links };
}
