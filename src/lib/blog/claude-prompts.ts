/** Prompts a user pastes into Claude (Desktop, Code, or claude.ai) connected to this app's MCP server. Pure text — tested. */

export function suggestIdeasPrompt(brandSlug: string, brandName: string, count = 5): string {
  return [
    `Using the JamSam Social connector, suggest ${count} blog post ideas for ${brandName}.`,
    ``,
    `1. Call list_keyword_opportunities(brand: "${brandSlug}", limit: 40) to see the ranked keyword gaps from our SEMrush and keyword research. Check data_freshness and tell me if it is stale.`,
    `2. For each strong candidate, call check_cannibalization(brand: "${brandSlug}", keyword: "<keyword>") and drop any where has_conflict is true (we already have a page for it). A keyword merely being an opportunity is NOT a conflict.`,
    `3. Call search_site_pages(brand: "${brandSlug}") once so you know what the live site already covers, and prefer topics that fill a real gap.`,
    `4. Hand back a ranked shortlist of ${count}: for each give the target keyword, volume, difficulty, suggested_action (NEW or OPTIMIZE), a working title, and one sentence on the angle. Do not write any drafts yet — I will pick one.`,
  ].join("\n");
}

export function writePostPrompt(brandSlug: string, brandName: string, keyword?: string): string {
  const kw = keyword?.trim();
  const target = kw
    ? `targeting the keyword "${kw}".`
    : `targeting a keyword you pick from list_keyword_opportunities(brand: "${brandSlug}") — choose the highest-scoring NEW opportunity that passes the cannibalization check.`;
  return [
    `Using the JamSam Social connector, write and save a blog post draft for ${brandName} ${target}`,
    ``,
    `1. Call get_brand_guidelines(brand: "${brandSlug}") and follow BOTH the blog_style guide and the blog_post_spec exactly.`,
    `2. Call check_cannibalization(brand: "${brandSlug}", keyword: "${kw ?? "<keyword>"}") first. If has_conflict is true, STOP and tell me which page conflicts and whether to OPTIMIZE it instead — do not create a new draft.`,
    `3. Call search_site_pages(brand: "${brandSlug}", q: "<topic>") and link to 2–3 relevant existing pages in the body. Call list_media_assets(brand: "${brandSlug}") or search_wp_media to pick a real hosted featured image; never invent image URLs.`,
    `4. Call create_article(brand: "${brandSlug}", ...) with title, slug, content_html (<h2>/<h3>, <p>, <ul>, <a>, hosted <img> only), excerpt, seo_title ending with the brand SEO suffix, meta_description (120–156 chars including the keyword), primary_keyword, secondary_keywords, featured_media_url + featured_alt, decision "new", and a one-line rationale.`,
    `5. It lands as a draft on the Blog page for me to review — do not push it to WordPress. Reply with the article title, the primary keyword, and any warnings create_article returned.`,
  ].join("\n");
}
