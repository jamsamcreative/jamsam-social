import { describe, it, expect } from "vitest";
import { parseTags, validateUpload, MAX_UPLOAD_BYTES } from "@/lib/media/schema";

describe("parseTags", () => {
  it("splits on commas, trims, lowercases, dedupes, drops empties", () => {
    expect(parseTags(" Shop, exterior ,,SHOP, Interior ")).toEqual(["shop", "exterior", "interior"]);
  });
  it("returns [] for blank input", () => {
    expect(parseTags("")).toEqual([]);
  });
});

describe("validateUpload", () => {
  it("accepts a small image", () => {
    expect(validateUpload({ type: "image/jpeg", size: 1000 })).toEqual({ ok: true });
  });
  it("rejects non-images", () => {
    const r = validateUpload({ type: "application/pdf", size: 1000 });
    expect(r).toEqual({ ok: false, error: "Only image files are allowed" });
  });
  it("rejects files over 20 MB", () => {
    const r = validateUpload({ type: "image/png", size: MAX_UPLOAD_BYTES + 1 });
    expect(r).toEqual({ ok: false, error: "Images must be 20 MB or smaller" });
  });
});
