"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { parseTags, validateUpload, extensionFor } from "./schema";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function currentUserId(): Promise<string | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function uploadMedia(brandId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: "Choose at least one image" };
  const altText = String(formData.get("alt_text") ?? "").trim() || null;
  const tags = parseTags(String(formData.get("tags") ?? ""));

  const admin = createAdminSupabase();
  const failures: string[] = [];

  for (const file of files) {
    const v = validateUpload(file);
    if (!v.ok) {
      failures.push(`${file.name}: ${v.error}`);
      continue;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    let width: number | null = null;
    let height: number | null = null;
    try {
      const m = await sharp(bytes).metadata();
      width = m.width ?? null;
      height = m.height ?? null;
    } catch {
      // Not fatal; dimensions stay null.
    }

    const path = `${brandId}/${randomUUID()}.${extensionFor(file.type, file.name)}`;
    const { error: upErr } = await admin.storage.from("media").upload(path, bytes, { contentType: file.type, upsert: false });
    if (upErr) {
      failures.push(`${file.name}: ${upErr.message}`);
      continue;
    }
    const { data: pub } = admin.storage.from("media").getPublicUrl(path);

    const { error: dbErr } = await admin.from("media_assets").insert({
      brand_id: brandId,
      storage_path: path,
      public_url: pub.publicUrl,
      filename: file.name,
      mime_type: file.type,
      width,
      height,
      alt_text: altText,
      tags,
      uploaded_by: userId,
    });
    if (dbErr) {
      await admin.storage.from("media").remove([path]);
      failures.push(`${file.name}: ${dbErr.message}`);
    }
  }

  revalidatePath("/media");
  if (failures.length === files.length) return { ok: false, error: failures.join("; ") };
  if (failures.length > 0) return { ok: false, error: `Some files failed: ${failures.join("; ")}` };
  return { ok: true };
}

export async function updateMediaAsset(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await currentUserId())) return { ok: false, error: "Not signed in" };
  const alt_text = String(formData.get("alt_text") ?? "").trim() || null;
  const tags = parseTags(String(formData.get("tags") ?? ""));
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("media_assets").update({ alt_text, tags }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/media");
  return { ok: true };
}

export async function deleteMediaAsset(id: string): Promise<ActionResult> {
  if (!(await currentUserId())) return { ok: false, error: "Not signed in" };
  const admin = createAdminSupabase();
  const { data: row, error: readErr } = await admin.from("media_assets").select("storage_path").eq("id", id).single();
  if (readErr || !row) return { ok: false, error: "Asset not found" };
  const { error: rmErr } = await admin.storage.from("media").remove([row.storage_path]);
  if (rmErr) return { ok: false, error: rmErr.message };
  const { error: delErr } = await admin.from("media_assets").delete().eq("id", id);
  if (delErr) return { ok: false, error: delErr.message };
  revalidatePath("/media");
  return { ok: true };
}
