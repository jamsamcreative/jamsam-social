"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MediaItem } from "@/lib/database.types";
import type { MediaAsset } from "@/lib/media/queries";

export function MediaPicker({
  assets,
  value,
  onChange,
  max = 10,
  pickOne,
  openExternal,
  onOpenChange,
}: {
  assets: MediaAsset[];
  value: MediaItem[];
  onChange: (v: MediaItem[]) => void;
  max?: number;
  /** Single-pick mode: called with the chosen item, dialog closes, selection strip hidden. */
  pickOne?: (item: MediaItem) => void;
  openExternal?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openExternal ?? openState;
  const setOpen = (o: boolean) => {
    setOpenState(o);
    onOpenChange?.(o);
  };
  const [url, setUrl] = useState("");
  const add = (item: MediaItem) => {
    if (pickOne) {
      pickOne(item);
      setOpen(false);
      return;
    }
    if (value.length < max && !value.some((v) => v.url === item.url)) onChange([...value, item]);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {!pickOne && value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((m, i) => (
            <div key={m.url} className="w-24">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt={m.alt ?? ""} className="aspect-square w-24 rounded-md border object-cover" />
              <div className="mt-1 flex justify-between text-xs">
                <button type="button" onClick={() => move(i, -1)} aria-label="Move left">
                  ←
                </button>
                <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} aria-label="Remove" className="text-destructive">
                  ✕
                </button>
                <button type="button" onClick={() => move(i, 1)} aria-label="Move right">
                  →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(true)} disabled={!pickOne && value.length >= max}>
          Choose from library
        </Button>
        <Input placeholder="or paste an image URL" value={url} onChange={(e) => setUrl(e.target.value)} className="max-w-sm" />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (/^https?:\/\//.test(url)) {
              add({ url });
              setUrl("");
            }
          }}
          disabled={!url || (!pickOne && value.length >= max)}
        >
          Add URL
        </Button>
      </div>
      {!pickOne && (
        <p className="text-xs text-muted-foreground">
          {value.length}/{max} images. First image is the cover.
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Brand library</DialogTitle>
          </DialogHeader>
          {assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No images in this brand&apos;s library yet.</p>
          ) : (
            <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
              {assets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => add({ url: a.public_url, alt: a.alt_text, media_asset_id: a.id })}
                  className="overflow-hidden rounded-md border hover:ring-2 hover:ring-ring"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.public_url} alt={a.alt_text ?? ""} className="aspect-square w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
