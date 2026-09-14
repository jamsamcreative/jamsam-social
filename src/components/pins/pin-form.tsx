"use client";
import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MediaPicker } from "@/components/posts/media-picker";
import { savePin, syncBoards, type ActionResult } from "@/lib/pins/actions";
import { validatePin } from "@/lib/pins/rules";
import { utcToZonedLocal } from "@/lib/time/zoned";
import { enqueueJob } from "@/lib/jobs/actions";
import type { MediaAsset } from "@/lib/media/queries";
import type { Pin, PinBoard } from "@/lib/pins/queries";
import type { MediaItem } from "@/lib/database.types";

export type ProjectOption = { id: string; title: string; url: string | null; image_url: string | null; dims: string | null; location: string | null };
type Props = { brand: { id: string; name: string; timezone: string; website_url: string | null }; pin?: Pin; assets: MediaAsset[]; boards: PinBoard[]; projects: ProjectOption[]; prefill?: { project_id?: string; media_asset_id?: string } };

export function PinForm({ brand, pin, assets, boards, projects, prefill }: Props) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(savePin, null);
  const initialProject = prefill?.project_id ? projects.find((p) => p.id === prefill.project_id) : undefined;
  const initialAsset = prefill?.media_asset_id ? assets.find((a) => a.id === prefill.media_asset_id) : undefined;
  const [boardId, setBoardId] = useState(pin?.board_id ?? boards[0]?.board_id ?? "");
  const [title, setTitle] = useState(pin?.title ?? initialProject?.title ?? "");
  const [description, setDescription] = useState(pin?.description ?? "");
  const [link, setLink] = useState(pin?.link ?? initialProject?.url ?? brand.website_url ?? "");
  const [alt, setAlt] = useState(pin?.alt_text ?? initialAsset?.alt_text ?? "");
  const [imageUrl, setImageUrl] = useState(pin?.image_url ?? initialProject?.image_url ?? initialAsset?.public_url ?? "");
  const [mediaAssetId, setMediaAssetId] = useState<string | null>(pin?.media_asset_id ?? initialAsset?.id ?? null);
  const [projectId, setProjectId] = useState<string | null>(pin?.project_id ?? initialProject?.id ?? null);
  const [scheduledLocal, setScheduledLocal] = useState(pin?.scheduled_at ? utcToZonedLocal(pin.scheduled_at, brand.timezone) : "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Saved");
      for (const w of state.warnings ?? []) toast.warning(w);
      if (state.id && !pin) router.push(`/pins/${state.id}`);
      else router.refresh();
    } else toast.error(state.error);
  }, [state, pin, router]);

  // Poll a queued pin job; when it completes, load the draft it wrote.
  useEffect(() => {
    if (!jobId) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { status: string; result: { pin_id?: string } | null; error: string | null };
      if (j.status === "completed" && j.result?.pin_id) {
        setJobId(null);
        toast.success("Pin written — review it");
        router.push(`/pins/${j.result.pin_id}`);
      } else if (j.status === "failed") {
        setJobId(null);
        toast.error(j.error ?? "Pin job failed");
      }
    }, 2000);
    return () => clearInterval(t);
  }, [jobId, router]);

  const boardName = boards.find((b) => b.board_id === boardId)?.name;
  const payload = JSON.stringify({ id: pin?.id, brand_id: brand.id, board_id: boardId, board_name: boardName, title, description, link, alt_text: alt, image_url: imageUrl, media_asset_id: mediaAssetId, project_id: projectId, scheduled_local: scheduledLocal });
  let host: string | null = null;
  try {
    host = brand.website_url ? new URL(brand.website_url).hostname : null;
  } catch {}
  const check = validatePin({ board_id: boardId, title, description, link: link || null, alt_text: alt || null, image_url: imageUrl }, host);

  const pickAsset = useCallback((item: MediaItem) => {
    setImageUrl(item.url);
    setMediaAssetId(item.media_asset_id ?? null);
    setProjectId(null);
    if (item.alt && !alt) setAlt(item.alt);
  }, [alt]);
  const pickProject = (p: ProjectOption) => {
    setProjectId(p.id);
    setMediaAssetId(null);
    if (p.image_url) setImageUrl(p.image_url);
    if (!title) setTitle(p.title);
    if (p.url) setLink(p.url);
  };
  const writeWithAi = async () => {
    if (!mediaAssetId && !projectId) return void toast.error("Pick an image from the library or a project first — the AI writes from it");
    const r = await enqueueJob({ brandId: brand.id, type: "pin", input: { media_asset_id: mediaAssetId ?? undefined, project_id: projectId ?? undefined, board_id: boardId || undefined } });
    if (!r.ok) return void toast.error(r.error);
    setJobId(r.id ?? null);
    toast.info("Pin job queued — if it's on the MCP runner, run it from your Claude session and keep this page open");
  };

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <input type="hidden" name="payload" value={payload} />
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="pin-title">Title <span className="text-xs text-muted-foreground">({title.length}/100 — lead with dimensions)</span></Label>
          <Input id="pin-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pin-desc">Description <span className={`text-xs ${description.length >= 100 && description.length <= 300 ? "text-green-700" : "text-muted-foreground"}`}>({description.length} chars — aim for 100–300, indexed as search text; no emoji or hashtags)</span></Label>
          <Textarea id="pin-desc" rows={6} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} required />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="pin-link">Link (our site)</Label><Input id="pin-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></div>
          <div className="space-y-1"><Label htmlFor="pin-alt">Alt text</Label><Input id="pin-alt" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={500} placeholder="Literal description of the photo" /></div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pin-when">Schedule ({brand.timezone})</Label>
          <Input id="pin-when" type="datetime-local" value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} className="w-fit" />
          <p className="text-xs text-muted-foreground">Pinterest has no native scheduling; JamSam Social publishes approved pins at this time.</p>
        </div>
        {(check.errors.length > 0 || check.warnings.length > 0) && (
          <ul className="space-y-0.5 text-xs">
            {check.errors.map((e) => <li key={e} className="text-destructive">✕ {e}</li>)}
            {check.warnings.map((w) => <li key={w} className="text-amber-700">△ {w}</li>)}
          </ul>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>{pending ? "Saving..." : pin ? "Save changes" : "Create draft"}</Button>
          <Button type="button" variant="outline" disabled={!!jobId} onClick={writeWithAi}>{jobId ? "Waiting for the pin job…" : "✨ Write pin"}</Button>
        </div>
      </div>
      <aside className="space-y-4">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="pin-board">Board</Label>
            <button type="button" className="text-xs underline" onClick={async () => { const r = await syncBoards(brand.id); if (r.ok) { toast.success(r.warnings?.[0] ?? "Synced"); router.refresh(); } else toast.error(r.error); }}>Sync boards</button>
          </div>
          <select id="pin-board" value={boardId} onChange={(e) => setBoardId(e.target.value)} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" required>
            {boards.length === 0 && <option value="">No boards synced — connect Pinterest</option>}
            {boards.map((b) => <option key={b.board_id} value={b.board_id}>{b.name}{b.pin_count != null ? ` (${b.pin_count})` : ""}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label>Image</Label>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={alt} className="w-full rounded-md border object-cover" />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-md border text-xs text-muted-foreground">No image yet</div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>From media library</Button>
            {projects.length > 0 && (
              <select className="rounded-md border bg-background px-2 py-1 text-sm" value="" onChange={(e) => { const p = projects.find((x) => x.id === e.target.value); if (p) pickProject(p); }} aria-label="From content bank">
                <option value="">From content bank…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{[p.dims, p.title].filter(Boolean).join(" · ")}</option>)}
              </select>
            )}
          </div>
          <Input id="pin-image-url" type="url" value={imageUrl} onChange={(e) => { setImageUrl(e.target.value); setMediaAssetId(null); }} placeholder="or paste an image URL" />
          <div className="hidden">
            <MediaPicker assets={assets} value={[]} onChange={() => {}} pickOne={pickAsset} openExternal={pickerOpen} onOpenChange={setPickerOpen} />
          </div>
        </div>
      </aside>
    </form>
  );
}
