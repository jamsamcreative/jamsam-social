"use client";
import { useState } from "react";
import { AssetDialog } from "./asset-dialog";
import type { MediaAsset } from "@/lib/media/queries";

export function AssetGrid({ assets }: { assets: MediaAsset[] }) {
  const [open, setOpen] = useState<MediaAsset | null>(null);
  if (assets.length === 0) return <p className="text-muted-foreground">No images yet. Upload some above.</p>;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {assets.map((a) => (
          <button key={a.id} type="button" onClick={() => setOpen(a)} className="group overflow-hidden rounded-md border bg-muted/30 text-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.public_url} alt={a.alt_text ?? ""} className="aspect-square w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
            <div className="truncate px-2 py-1 text-xs text-muted-foreground">{a.alt_text ?? a.filename}</div>
          </button>
        ))}
      </div>
      <AssetDialog asset={open} onClose={() => setOpen(null)} />
    </>
  );
}
