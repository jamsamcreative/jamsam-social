"use client";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveGuideline, type ActionResult } from "@/lib/guidelines/actions";
import type { GuidelineKind } from "@/lib/guidelines/kinds";

export function GuidelineEditor({ brandId, kind, initial, description }: { brandId: string; kind: GuidelineKind; initial: string; description: string }) {
  const action = saveGuideline.bind(null, brandId, kind);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success("Saved");
    else toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-sm text-muted-foreground">{description}</p>
      <Textarea name="body_md" defaultValue={initial} rows={22} className="font-mono text-sm" placeholder="Markdown..." />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
