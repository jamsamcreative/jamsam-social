export type CaptionPlatform = "facebook" | "instagram";
const LIMITS: Record<CaptionPlatform, { max: number; label: string }> = {
  instagram: { max: 2200, label: "Instagram captions must be ≤ 2,200 characters" },
  facebook: { max: 5000, label: "Facebook captions must be ≤ 5,000 characters" },
};
const CONTRACTION = /\b\w+'(re|s|ll|ve|d|t|m)\b/i;

/** Hard brand rules. Returns violations; empty means OK. Enforced in code, not just prompts. */
export function validateCaption(platform: CaptionPlatform, text: string): string[] {
  const out: string[] = [];
  if (text.includes("—")) out.push("Contains an em dash (—)");
  if (text.includes("–")) out.push("Contains an en dash (–)");
  if (/\bactually\b/i.test(text)) out.push('Uses the word "actually"');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words >= 40 && !CONTRACTION.test(text)) out.push("No contractions found (use we're, it's, you'll …)");
  if (text.length > LIMITS[platform].max) out.push(LIMITS[platform].label);
  return out;
}
