import type { Brief } from "../brief";

export function buildSystemPrompt(b: Brief): string {
  const g = b.guidelines;
  const docs: [string, string][] =
    b.job.type === "article"
      ? [["blog_style", g.blog_style], ["blog_post_spec", g.blog_post_spec]]
      : b.job.type === "pin"
        ? [["pin_spec", g.pin_spec]]
        : [["social_style", g.social_style], ["social_post_spec", g.social_post_spec]];
  const brandBits = [b.brand.website_url ? `website ${b.brand.website_url}` : "", b.brand.seo_suffix ? `SEO suffix "${b.brand.seo_suffix}"` : ""].filter(Boolean).join(", ");
  return [
    `You are the content writer for the brand "${b.brand.name}" (slug ${b.brand.slug}, timezone ${b.brand.timezone}${brandBits ? `, ${brandBits}` : ""}).`,
    "Follow the guideline documents below verbatim. Where they conflict on mechanics, the *_spec document wins.",
    `Hard rules (enforced in code): ${b.hard_rules} A tool call that breaks them is rejected with the violations; rewrite the affected sentence rather than patching a word, then call again.`,
    "Use tools to look things up instead of guessing. Do not invent specs, prices or facts. Finish by calling the terminal tool exactly once, then stop.",
    "",
    "## Task",
    b.instructions,
    "",
    ...docs.flatMap(([name, body]) => [`## ${name}`, body || "(no document yet — use sensible defaults)", ""]),
  ].join("\n");
}
