import type { JobType } from "../schemas";

/** Rules enforced in code by create_post / submit_captions (captions) and warned on by create_article (body). Shown to every writer up front. */
export const HARD_RULES =
  'No em dashes (—) or en dashes (–) anywhere. Never use the word "actually". Use contractions (we\'re, it\'s, you\'ll). Instagram captions ≤ 2,200 characters, Facebook ≤ 5,000. Never invent specs, prices or facts.';

/** Type-specific marching orders. Shared by the in-app runner (system prompt) and claim_job (brief.instructions). */
export const INSTRUCTIONS: Record<JobType, string> = {
  caption: [
    "Write a Facebook caption and an Instagram caption for the post in `post` (title, link, images with alt text).",
    "Follow social_style and social_post_spec exactly. Match the tone of `recent_captions`.",
    "Pick the category from `content_mix.favour_next` unless the post clearly belongs elsewhere; pass it as category_slug.",
    "Finish by calling submit_captions exactly once with both captions. Do not call create_post.",
  ].join("\n"),
  article: [
    "Write a complete SEO blog article for the brief in `job.input` (topic, keywords, decision, notes).",
    "Follow blog_style and blog_post_spec exactly. H1 = title with the primary keyword near the front; use <h2>/<h3> sections; 900–1500 words unless the spec says otherwise.",
    "Choose a featured image from `media` with used_as_featured=false, and 1–3 body images; if nothing fits, call search_wp_media. Use hosted URLs only.",
    "Link to 1–3 relevant `existing_articles` or `site_pages` by url where natural.",
    "Before writing, call check_cannibalization with your primary keyword and proposed slug. If has_conflict is true, do not create a NEW article: either pick decision 'optimize'/'rewrite' targeting the existing slug, or choose a different keyword from the brief.",
    "seo_title must end with the brand's seo_suffix; meta_description 120–156 chars including the primary keyword; slug contains the primary keyword.",
    "Finish by calling create_article exactly once. If it returns warnings, fix them with update_article.",
  ].join("\n"),
  promo: [
    "Write a short social post promoting `article` (title, excerpt, url, featured_media).",
    'Condense the article into a hook + 1–2 lines of value + CTA like "Read more here 👉 <url>". Use featured_media.url as the image and link_url = article.url.',
    "If job.input.scheduled_after is set, schedule both targets at or after it (ISO with the brand timezone offset).",
    "Finish by calling create_post exactly once with article_id = job.input.article_id.",
  ].join("\n"),
  seo_cluster: [
    "Group the keywords in `keywords` into topic clusters a content strategist would use for this brand: 5–15 short cluster names (2–3 words, Title Case), reusing `existing_clusters` where they fit.",
    "Every keyword gets exactly one cluster. Keep local-intent variants with their topic (e.g. 'metal roofing spokane' → Metal Roofing).",
    "Finish by calling assign_clusters exactly once with every keyword.",
  ].join("\n"),
  pin: [
    "Write one Pinterest pin for the photo/project in the brief (`asset` or `project`). Pinterest is a search engine, not a feed: follow pin_spec exactly.",
    "Title ≤ 100 chars, lead with dimensions when they exist (e.g. '40x60 Post Frame Shop in Spokane, WA'). Description 100–300 chars of plain, searchable text. No emoji, no hashtags.",
    "Link to our own site: the project's url when it has one, otherwise the brand website. Never invent a dimension, colour or location; if the brief lacks it, leave it out.",
    "Pick the board from `boards` that a browser of that board would expect this pin on (job.input.board_id wins when set). Do not repeat a title from `recent_pin_titles`.",
    "Finish by calling create_pin exactly once.",
  ].join("\n"),
  rewrite: [
    "Write a fresh variant of the captions on `post`: same facts, same media and link, new angle and opening. Do not reuse the first sentence.",
    "Follow social_style and social_post_spec. Keep the same category if the post has one.",
    "Finish by calling create_post exactly once with recycled_from = post.id, media_urls = post.media urls, link_url = post.link_url.",
  ].join("\n"),
};
