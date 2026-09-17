import { describe, it, expect } from "vitest";
import { brandSwitchTarget } from "@/components/shell/brand-switch-target";

describe("brandSwitchTarget", () => {
  it("dashboard → dashboard", () => expect(brandSwitchTarget("/brands/ssa", "kit")).toBe("/brands/kit"));
  it("keeps the sub-page", () => expect(brandSwitchTarget("/brands/ssa/settings", "kit")).toBe("/brands/kit/settings"));
  it("keeps nested pages", () => expect(brandSwitchTarget("/brands/ssa/connections/meta/pick", "kit")).toBe("/brands/kit/connections/meta/pick"));
  it("stays put elsewhere", () => {
    expect(brandSwitchTarget("/seo", "kit")).toBeNull();
    expect(brandSwitchTarget("/brands", "kit")).toBeNull();
    expect(brandSwitchTarget("/brands/new", "kit")).toBeNull();
  });
});
