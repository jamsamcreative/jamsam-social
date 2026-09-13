import { describe, it, expect } from "vitest";
import { GUIDELINE_KINDS, isGuidelineKind } from "@/lib/guidelines/kinds";

describe("guideline kinds", () => {
  it("lists all five kinds in display order", () => {
    expect(GUIDELINE_KINDS.map((k) => k.kind)).toEqual(["social_style", "social_post_spec", "blog_style", "blog_post_spec", "pin_spec"]);
  });
  it("type-guards unknown strings", () => {
    expect(isGuidelineKind("blog_style")).toBe(true);
    expect(isGuidelineKind("nope")).toBe(false);
  });
});
