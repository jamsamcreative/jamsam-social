import { z } from "zod";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Optional text field from a form: "" or missing becomes null. */
const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : (v ?? null)),
  z.string().nullable(),
);

export const brandInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug may only contain lowercase letters, numbers, and hyphens"),
  website_url: optionalText.refine((v) => v === null || z.string().url().safeParse(v).success, "Enter a valid URL"),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
  seo_suffix: optionalText,
});

export type BrandInput = z.infer<typeof brandInputSchema>;
