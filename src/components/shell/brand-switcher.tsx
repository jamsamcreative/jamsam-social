"use client";
import { useTransition } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setCurrentBrand } from "@/lib/current-brand";
import type { Brand } from "@/lib/brands/queries";

export function BrandSwitcher({ brands, current }: { brands: Brand[]; current: string | null }) {
  const [pending, start] = useTransition();
  if (brands.length === 0) return <span className="text-sm text-muted-foreground">No brands yet</span>;
  return (
    <Select
      value={current ?? undefined}
      onValueChange={(slug) => slug && start(() => setCurrentBrand(slug))}
      disabled={pending}
      items={brands.map((b) => ({ value: b.slug, label: b.name }))}
    >
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Select a brand">{(value: string | null) => brands.find((b) => b.slug === value)?.name ?? "Select a brand"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {brands.map((b) => (
          <SelectItem key={b.id} value={b.slug}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
