import { z } from "zod";

const mediaItem = z.object({
  url: z.string().url().regex(/^https?:/, "Image URLs must start with http(s)"),
  alt: z.string().nullable().optional(),
  media_asset_id: z.string().uuid().nullable().optional(),
});

const target = z.object({
  platform: z.enum(["facebook", "instagram"]),
  enabled: z.boolean(),
  caption: z.string().default(""),
  scheduled_local: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Invalid schedule time").nullable(),
  ),
});

export const postFormSchema = z.object({
  id: z.string().uuid().optional(),
  brand_id: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required").max(200),
  link_url: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().url("Enter a valid link URL").nullable(),
  ),
  media: z.array(mediaItem).max(10, "At most 10 images"),
  targets: z.array(target).length(2),
  category_id: z.string().uuid().nullable().default(null),
});
export type PostFormInput = z.infer<typeof postFormSchema>;

export function parsePostForm(formData: FormData) {
  const raw = formData.get("payload");
  if (typeof raw !== "string") return postFormSchema.safeParse({});
  try {
    return postFormSchema.safeParse(JSON.parse(raw));
  } catch {
    return postFormSchema.safeParse({});
  }
}
