"use client";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/brands/schema";
import type { ActionResult } from "@/lib/brands/actions";
import type { Brand } from "@/lib/brands/queries";

type Props = {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  brand?: Brand;
  submitLabel: string;
};

export function BrandForm({ action, brand, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const [slug, setSlug] = useState(brand?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(brand));

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Client name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={brand?.name}
          required
          onChange={(e) => {
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          name="slug"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
        />
        <p className="text-xs text-muted-foreground">Used in URLs and by the AI tools. Lowercase, hyphens only.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="website_url">Website URL</Label>
        <Input id="website_url" name="website_url" type="url" placeholder="https://" defaultValue={brand?.website_url ?? ""} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="timezone">Timezone</Label>
        <Input id="timezone" name="timezone" defaultValue={brand?.timezone ?? "America/Los_Angeles"} required />
        <p className="text-xs text-muted-foreground">IANA name, e.g. America/Los_Angeles, America/Denver.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="seo_suffix">SEO title suffix</Label>
        <Input id="seo_suffix" name="seo_suffix" placeholder=" | Client Name" defaultValue={brand?.seo_suffix ?? ""} />
      </div>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
