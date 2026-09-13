import { z } from "zod";

const optionalText = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : (v ?? null)), z.string().nullable());
const term = z.object({ id: z.number().int(), name: z.string() });
const mediaItem = z.object({ url: z.string().url(), alt: z.string().nullable().optional(), media_asset_id: z.string().uuid().nullable().optional() });

export const articleFormSchema = z.object({
  id: z.string().uuid().optional(),
  brand_id: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required").max(200),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug may only contain lowercase letters, numbers, and hyphens"),
  content_html: z.string().default(""),
  excerpt: optionalText,
  seo_title: optionalText,
  meta_description: optionalText,
  primary_keyword: optionalText,
  secondary_keywords: z.preprocess(
    (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => String(s).trim().toLowerCase()).filter((s, i, a) => s && a.indexOf(s) === i),
    z.array(z.string()).max(20, "At most 20 secondary keywords"),
  ),
  featured_media: mediaItem.nullable(),
  categories: z.array(term).default([]),
  tags: z.array(term).default([]),
  decision: z.enum(["new", "rewrite", "optimize"]).default("new"),
  rationale: optionalText,
});
export type ArticleFormInput = z.infer<typeof articleFormSchema>;

export function parseArticleForm(formData: FormData) {
  const raw = formData.get("payload");
  if (typeof raw !== "string") return articleFormSchema.safeParse({});
  try {
    return articleFormSchema.safeParse(JSON.parse(raw));
  } catch {
    return articleFormSchema.safeParse({});
  }
}
