import { describe, it, expect } from "vitest";
import { seoToolsFormSchema, parseSeoTools, seoToolsSchema } from "@/lib/brands/seo-tools";

describe("seoToolsFormSchema", () => {
  it("builds the stored shape from form fields, splitting keywords by line and trimming", () => {
    const r = seoToolsFormSchema.parse({
      lf_place_id: " ChIJabc123 ",
      lf_business_name: "Maurer Law",
      lf_keywords: "personal injury lawyer spokane\n\n  car accident attorney  \n",
      ahrefs_target: "https://personalinjurylawyer-spokane.com/",
      ahrefs_project_id: "",
    });
    expect(r).toEqual({
      local_falcon: { place_id: "ChIJabc123", business_name: "Maurer Law", keywords: ["personal injury lawyer spokane", "car accident attorney"] },
      ahrefs: { target: "personalinjurylawyer-spokane.com" },
    });
  });
  it("omits a tool entirely when all its fields are blank", () => {
    const r = seoToolsFormSchema.parse({ lf_place_id: "", lf_business_name: "", lf_keywords: "", ahrefs_target: "", ahrefs_project_id: "" });
    expect(r).toEqual({});
  });
  it("normalises an Ahrefs target to a bare host (no scheme, www or path)", () => {
    const r = seoToolsFormSchema.parse({ ahrefs_target: "http://www.Example.com/blog" });
    expect(r.ahrefs?.target).toBe("example.com");
  });
  it("keeps the Ahrefs project id when given", () => {
    const r = seoToolsFormSchema.parse({ ahrefs_target: "example.com", ahrefs_project_id: "abc-123" });
    expect(r.ahrefs).toEqual({ target: "example.com", project_id: "abc-123" });
  });
  it("requires a place id when any Local Falcon field is filled", () => {
    expect(() => seoToolsFormSchema.parse({ lf_keywords: "lawyer" })).toThrow(/place id/i);
  });
});

describe("parseSeoTools", () => {
  it("returns {} for null, non-objects or invalid JSON shapes", () => {
    expect(parseSeoTools(null)).toEqual({});
    expect(parseSeoTools("nope")).toEqual({});
    expect(parseSeoTools({ local_falcon: { keywords: "x" } })).toEqual({});
  });
  it("passes a valid stored value through", () => {
    const v = { ahrefs: { target: "example.com" } };
    expect(parseSeoTools(v)).toEqual(v);
    expect(seoToolsSchema.parse(v)).toEqual(v);
  });
});
