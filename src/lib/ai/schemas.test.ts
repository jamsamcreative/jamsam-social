import { describe, it, expect } from "vitest";
import { parseJobInput, parseJobResult } from "@/lib/ai/schemas";

describe("job schemas", () => {
  it("accepts a caption input and rejects a missing post_id", () => {
    expect(parseJobInput("caption", { post_id: "3f5c1c1e-1b9a-4c1e-9a1e-1b9a4c1e9a1e" }).success).toBe(true);
    expect(parseJobInput("caption", {}).success).toBe(false);
  });
  it("defaults article decision to new and trims topic", () => {
    const r = parseJobInput("article", { topic: "  Deck staining  " });
    expect(r.success && r.data).toEqual({ topic: "Deck staining", decision: "new", secondary_keywords: [] });
  });
  it("validates caption results", () => {
    expect(parseJobResult("caption", { captions: { facebook: "a", instagram: "b" } }).success).toBe(true);
    expect(parseJobResult("caption", { captions: { facebook: "a" } }).success).toBe(false);
  });
});
