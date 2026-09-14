import { describe, it, expect } from "vitest";
import { categoryInputSchema, toRow, checkTotal } from "@/lib/categories/schema";

describe("category schema", () => {
  it("slugifies and converts percent to share", () => {
    expect(toRow(categoryInputSchema.parse({ name: "Project Showcase", target_percent: "40" }))).toMatchObject({ slug: "project-showcase", target_share: 0.4, description: null });
  });
  it("rejects totals over 100%", () => {
    expect(checkTotal([{ id: "a", target_share: 0.7 }], { target_share: 0.4 })).toMatch(/110%/);
    expect(checkTotal([{ id: "a", target_share: 0.7 }], { id: "a", target_share: 0.4 })).toBeNull();
  });
});
