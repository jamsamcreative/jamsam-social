import { z } from "zod";

export const pinFormSchema = z.object({
  id: z.string().uuid().optional(),
  brand_id: z.string().uuid(),
  board_id: z.string().min(1, "Pick a board"),
  board_name: z.string().optional(),
  title: z.string().trim().min(1, "Title is required").max(100),
  description: z.string().trim().min(1, "Description is required").max(500),
  link: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().url("Enter a valid link").nullable()),
  alt_text: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().max(500).nullable()),
  image_url: z.string().url("Pick an image"),
  media_asset_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  scheduled_local: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Invalid schedule time").nullable()),
});
export type PinFormInput = z.infer<typeof pinFormSchema>;

export function parsePinForm(formData: FormData) {
  const raw = formData.get("payload");
  if (typeof raw !== "string") return pinFormSchema.safeParse({});
  try {
    return pinFormSchema.safeParse(JSON.parse(raw));
  } catch {
    return pinFormSchema.safeParse({});
  }
}
