"use client";
import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MediaPicker } from "./media-picker";
import { GenerateCaptions } from "./generate-captions";
import { savePost, type ActionResult } from "@/lib/posts/actions";
import { PLATFORMS, PLATFORM_LABELS, type Platform } from "@/lib/posts/status";
import { utcToZonedLocal } from "@/lib/time/zoned";
import type { MediaItem } from "@/lib/database.types";
import type { MediaAsset } from "@/lib/media/queries";
import type { PostWithTargets } from "@/lib/posts/queries";
import type { PostCategory } from "@/lib/categories/queries";
import type { CaptionResult } from "@/lib/ai/schemas";

type TargetState = { platform: Platform; enabled: boolean; caption: string; scheduled_local: string | null };

// Brand-schedule defaults for a slot opened from the plan/calendar "Add another" link.
const DEFAULT_SLOT_TIME: Partial<Record<Platform, string>> = { facebook: "15:30", instagram: "17:30" };

export function PostForm({
  brand,
  post,
  assets,
  categories = [],
  defaultDate,
}: {
  brand: { id: string; name: string; timezone: string };
  post?: PostWithTargets;
  assets: MediaAsset[];
  categories?: PostCategory[];
  defaultDate?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(savePost, null);
  const [title, setTitle] = useState(post?.title ?? "");
  const [link, setLink] = useState(post?.link_url ?? "");
  const [media, setMedia] = useState<MediaItem[]>((post?.media as MediaItem[] | null) ?? []);
  const [categoryId, setCategoryId] = useState<string | null>(post?.category_id ?? null);
  const [targets, setTargets] = useState<TargetState[]>(
    PLATFORMS.map((p) => {
      const t = post?.targets.find((x) => x.platform === p);
      return {
        platform: p,
        enabled: post ? Boolean(t) : true,
        caption: t?.caption ?? "",
        scheduled_local: t?.scheduled_at
          ? utcToZonedLocal(t.scheduled_at, brand.timezone)
          : !post && defaultDate && DEFAULT_SLOT_TIME[p]
            ? `${defaultDate}T${DEFAULT_SLOT_TIME[p]}`
            : null,
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
  const payload = JSON.stringify({ id: post?.id, brand_id: brand.id, title, link_url: link, media, targets, category_id: categoryId });

  // Saves the current form state without navigating, so a caption job can reference the post id.
  const ensureSaved = async (): Promise<string | null> => {
    const fd = new FormData();
    fd.set("payload", payload);
    const r = await savePost(null, fd);
    if (!r.ok) {
      toast.error(r.error);
      return null;
    }
    return r.id ?? post?.id ?? null;
  };
  const applyCaptions = useCallback(
    (r: CaptionResult) => {
      setTargets((ts) => ts.map((t) => (t.platform === "facebook" || t.platform === "instagram" ? { ...t, caption: r.captions[t.platform] } : t)));
      if (r.category_slug) setCategoryId((cur) => categories.find((c) => c.slug === r.category_slug)?.id ?? cur);
    },
    [categories],
  );

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
        {categories.length > 0 && (
          <div className="space-y-1">
            <Label htmlFor="category">Category</Label>
            <select id="category" value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value || null)} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm">
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="space-y-1">
        <Label>Images</Label>
        <MediaPicker assets={assets} value={media} onChange={setMedia} />
      </div>
      <div className="flex items-center gap-3">
        {post ? (
          <GenerateCaptions brandId={brand.id} ensureSaved={ensureSaved} onResult={applyCaptions} />
        ) : (
          <p className="text-xs text-muted-foreground">Create the draft first to write captions with AI.</p>
        )}
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
