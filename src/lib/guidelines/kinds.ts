import type { Database } from "@/lib/database.types";

export type GuidelineKind = Database["public"]["Enums"]["guideline_kind"];

export const GUIDELINE_KINDS: { kind: GuidelineKind; label: string; description: string }[] = [
  { kind: "social_style", label: "Social style", description: "Voice, tone, vocabulary, emoji policy, hashtags, things to never say." },
  { kind: "social_post_spec", label: "Social post spec", description: "Required structure of a caption: hook, body, CTA, credibility block, links." },
  { kind: "blog_style", label: "Blog style", description: "Article voice, SEO rules, headings, internal links, alt text conventions." },
  { kind: "blog_post_spec", label: "Blog post spec", description: "The mechanical contract: images, SEO fields, WordPress push workflow." },
  { kind: "pin_spec", label: "Pinterest pin spec", description: "Title and description rules for pins, board selection, link policy." },
];

const SET = new Set<string>(GUIDELINE_KINDS.map((k) => k.kind));
export function isGuidelineKind(v: string): v is GuidelineKind {
  return SET.has(v);
}
