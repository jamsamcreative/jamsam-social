import type { JobType } from "../schemas";

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
    "Link to 1–3 relevant `existing_articles` by url where natural.",
    "seo_title must end with the brand's seo_suffix; meta_description 120–156 chars including the primary keyword; slug contains the primary keyword.",
    "Finish by calling create_article exactly once. If it returns warnings, fix them with update_article.",
  ].join("\n"),
  promo: [
    "Write a short social post promoting `article` (title, excerpt, url, featured_media).",
    'Condense the article into a hook + 1–2 lines of value + CTA like "Read more here 👉 <url>". Use featured_media.url as the image and link_url = article.url.',
    "If job.input.scheduled_after is set, schedule both targets at or after it (ISO with the brand timezone offset).",
    "Finish by calling create_post exactly once with article_id = job.input.article_id.",
  ].join("\n"),
  rewrite: [
    "Write a fresh variant of the captions on `post`: same facts, same media and link, new angle and opening. Do not reuse the first sentence.",
    "Follow social_style and social_post_spec. Keep the same category if the post has one.",
    "Finish by calling create_post exactly once with recycled_from = post.id, media_urls = post.media urls, link_url = post.link_url.",
  ].join("\n"),
};
