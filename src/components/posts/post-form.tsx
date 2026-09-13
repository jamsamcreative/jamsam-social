"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MediaPicker } from "./media-picker";
import { savePost, type ActionResult } from "@/lib/posts/actions";
import { PLATFORMS, PLATFORM_LABELS, type Platform } from "@/lib/posts/status";
import { utcToZonedLocal } from "@/lib/time/zoned";
import type { MediaItem } from "@/lib/database.types";
import type { MediaAsset } from "@/lib/media/queries";
import type { PostWithTargets } from "@/lib/posts/queries";

type TargetState = { platform: Platform; enabled: boolean; caption: string; scheduled_local: string | null };

export function PostForm({ brand, post, assets }: { brand: { id: string; name: string; timezone: string }; post?: PostWithTargets; assets: MediaAsset[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(savePost, null);
  const [title, setTitle] = useState(post?.title ?? "");
  const [link, setLink] = useState(post?.link_url ?? "");
  const [media, setMedia] = useState<MediaItem[]>((post?.media as MediaItem[] | null) ?? []);
  const [targets, setTargets] = useState<TargetState[]>(
    PLATFORMS.map((p) => {
      const t = post?.targets.find((x) => x.platform === p);
      return {
        platform: p,
        enabled: post ? Boolean(t) : true,
        caption: t?.caption ?? "",
        scheduled_local: t?.scheduled_at ? utcToZonedLocal(t.scheduled_at, brand.timezone) : null,
      };
    }),
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Saved");
      if (state.id && !post) router.push(`/posts/${state.id}`);
      else router.refresh();
    } else toast.error(state.error);
  }, [state, post, router]);

  const setT = (p: Platform, patch: Partial<TargetState>) => setTargets((ts) => ts.map((t) => (t.platform === p ? { ...t, ...patch } : t)));
  const payload = JSON.stringify({ id: post?.id, brand_id: brand.id, title, link_url: link, media, targets });

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="title">Title (internal)</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="link">Link URL (optional)</Label>
          <Input id="link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Images</Label>
        <MediaPicker assets={assets} value={media} onChange={setMedia} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {targets.map((t) => (
          <div key={t.platform} className="space-y-3 rounded-lg border p-4">
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" checked={t.enabled} onChange={(e) => setT(t.platform, { enabled: e.target.checked })} /> {PLATFORM_LABELS[t.platform]}
            </label>
            {t.enabled && (
              <>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`cap-${t.platform}`}>Caption</Label>
                  {t.platform === "instagram" && (
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={() => setT("instagram", { caption: targets.find((x) => x.platform === "facebook")?.caption ?? "" })}
                    >
                      Copy from Facebook
                    </button>
                  )}
                </div>
                <Textarea id={`cap-${t.platform}`} rows={10} value={t.caption} onChange={(e) => setT(t.platform, { caption: e.target.value })} />
                <p className="text-xs text-muted-foreground">
                  {t.caption.length} characters{t.platform === "instagram" ? " (max 2,200)" : ""}
                </p>
                <div className="space-y-1">
                  <Label htmlFor={`when-${t.platform}`}>Schedule ({brand.timezone})</Label>
                  <Input id={`when-${t.platform}`} type="datetime-local" value={t.scheduled_local ?? ""} onChange={(e) => setT(t.platform, { scheduled_local: e.target.value || null })} />
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : post ? "Save changes" : "Create draft"}
      </Button>
    </form>
  );
}
