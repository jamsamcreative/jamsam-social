import { describe, it, expect } from "vitest";
import { validateCaption } from "@/lib/ai/captions";

describe("validateCaption", () => {
  it("passes a clean caption", () => {
    expect(validateCaption("instagram", "We're back on site today and it's looking great 🔥")).toEqual([]);
  });
  it("flags em and en dashes", () => {
    expect(validateCaption("facebook", "We're here — and it's ready")).toContain("Contains an em dash (—)");
    expect(validateCaption("facebook", "We're here – and it's ready")).toContain("Contains an en dash (–)");
  });
  it("flags the word actually (case-insensitive, whole word)", () => {
    expect(validateCaption("facebook", "It's Actually done")).toContain('Uses the word "actually"');
    expect(validateCaption("facebook", "It's factually done")).toEqual([]);
  });
  it("requires contractions in longer captions", () => {
    const long = Array(45).fill("word").join(" ");
    expect(validateCaption("facebook", long)).toContain("No contractions found (use we're, it's, you'll …)");
  });
  it("enforces platform lengths", () => {
    expect(validateCaption("instagram", "it's " + "x".repeat(2200))).toContain("Instagram captions must be ≤ 2,200 characters");
    expect(validateCaption("facebook", "it's " + "x".repeat(5000))).toContain("Facebook captions must be ≤ 5,000 characters");
  });
});
