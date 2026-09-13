"use client";
import { useActionState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMediaAsset, deleteMediaAsset, type ActionResult } from "@/lib/media/actions";
import type { MediaAsset } from "@/lib/media/queries";

export function AssetDialog({ asset, onClose }: { asset: MediaAsset | null; onClose: () => void }) {
  const [deleting, startDelete] = useTransition();
  const action = asset ? updateMediaAsset.bind(null, asset.id) : async () => ({ ok: false as const, error: "No asset" });
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Saved");
      onClose();
    } else toast.error(state.error);
  }, [state, onClose]);

  if (!asset) return null;

  function remove() {
    if (!asset || !confirm(`Delete ${asset.filename}? This cannot be undone.`)) return;
    startDelete(async () => {
      const r = await deleteMediaAsset(asset.id);
      if (r.ok) {
        toast.success("Deleted");
        onClose();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{asset.filename}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.public_url} alt={asset.alt_text ?? ""} className="w-full rounded-md object-contain" />
          <form action={formAction} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="alt_text">Alt text</Label>
              <Input id="alt_text" name="alt_text" defaultValue={asset.alt_text ?? ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tags">Tags</Label>
              <Input id="tags" name="tags" defaultValue={asset.tags.join(", ")} />
            </div>
            <p className="text-xs text-muted-foreground">
              {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}
              {asset.mime_type}
            </p>
            <p className="break-all text-xs text-muted-foreground">{asset.public_url}</p>
            <div className="flex justify-between">
              <Button type="button" variant="destructive" onClick={remove} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete"}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
