import { z } from "zod";

/**
 * Per-brand identifiers for SEO tools Claude reaches through its own MCP connectors
 * (Local Falcon, Ahrefs). Reference only — no API keys, nothing is synced.
 */
export const seoToolsSchema = z.object({
  local_falcon: z
    .object({
      place_id: z.string().min(1),
      business_name: z.string().optional(),
      keywords: z.array(z.string()).default([]),
    })
    .optional(),
  ahrefs: z
    .object({
      target: z.string().min(1),
      project_id: z.string().optional(),
    })
    .optional(),
});
export type SeoTools = z.infer<typeof seoToolsSchema>;

/** Read the jsonb column defensively: anything malformed is treated as "not set". */
export function parseSeoTools(value: unknown): SeoTools {
  const r = seoToolsSchema.safeParse(value);
  return r.success ? r.data : {};
}

const text = z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string());

/** "https://www.Example.com/blog" → "example.com"; Ahrefs targets are bare hosts. */
export function normaliseTarget(input: string): string {
  const s = input.trim();
  if (!s) return "";
  try {
    return new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return s.toLowerCase();
  }
}

/** Flat form fields (one card per tool) → the stored shape. Blank tools are dropped. */
export const seoToolsFormSchema = z
  .object({
    lf_place_id: text.default(""),
    lf_business_name: text.default(""),
    lf_keywords: text.default(""),
    ahrefs_target: text.default(""),
    ahrefs_project_id: text.default(""),
  })
  .transform((f, ctx): SeoTools => {
    const out: SeoTools = {};
    const keywords = f.lf_keywords.split(/\r?\n/).map((k) => k.trim()).filter(Boolean);
    if (f.lf_place_id || f.lf_business_name || keywords.length) {
      if (!f.lf_place_id) {
        ctx.addIssue({ code: "custom", message: "Local Falcon needs a Google Place ID" });
        return z.NEVER;
      }
      out.local_falcon = { place_id: f.lf_place_id, ...(f.lf_business_name ? { business_name: f.lf_business_name } : {}), keywords };
    }
    const target = normaliseTarget(f.ahrefs_target);
    if (target || f.ahrefs_project_id) {
      if (!target) {
        ctx.addIssue({ code: "custom", message: "Ahrefs needs a target domain" });
        return z.NEVER;
      }
      out.ahrefs = { target, ...(f.ahrefs_project_id ? { project_id: f.ahrefs_project_id } : {}) };
    }
    return out;
  });
