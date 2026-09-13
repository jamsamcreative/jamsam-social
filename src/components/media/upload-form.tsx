"use client";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadMedia, type ActionResult } from "@/lib/media/actions";

export function UploadForm({ brandId }: { brandId: string }) {
  const action = uploadMedia.bind(null, brandId);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Uploaded");
      formRef.current?.reset();
    } else toast.error(state.error);
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <div className="space-y-1">
        <Label htmlFor="files">Images</Label>
        <Input id="files" name="files" type="file" accept="image/*" multiple required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="alt_text">Alt text (applied to all)</Label>
        <Input id="alt_text" name="alt_text" placeholder="40x60 shop with wainscot, Spokane WA" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tags">Tags (comma separated)</Label>
        <Input id="tags" name="tags" placeholder="shop, exterior" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading..." : "Upload"}
      </Button>
    </form>
  );
}
