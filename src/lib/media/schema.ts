export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of input.split(",")) {
    const t = raw.trim().toLowerCase();
    if (t && !seen.has(t)) seen.add(t);
  }
  return [...seen];
}

export function validateUpload(file: { type: string; size: number }): { ok: true } | { ok: false; error: string } {
  if (!file.type.startsWith("image/")) return { ok: false, error: "Only image files are allowed" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Images must be 20 MB or smaller" };
  return { ok: true };
}

export function extensionFor(mime: string, filename: string): string {
  const fromName = filename.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return mime.split("/")[1] ?? "bin";
}
