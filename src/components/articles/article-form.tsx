"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RichEditor } from "./editor";
import { SeoHints } from "./seo-hints";
import { TermSelect } from "./term-select";
import { MediaPicker } from "@/components/posts/media-picker";
import { saveArticle, type ActionResult } from "@/lib/articles/actions";
import { finalSeoTitle, metaDescriptionWarning } from "@/lib/articles/push";
import { slugify } from "@/lib/brands/schema";
import type { MediaItem, TermRef } from "@/lib/database.types";
import type { MediaAsset } from "@/lib/media/queries";
import type { ArticleWithBrand } from "@/lib/articles/queries";
import type { WpTerms } from "@/lib/wordpress/terms";

type Brand = { id: string; name: string; timezone: string; seo_suffix: string | null };

export function ArticleForm({ brand, article, assets, terms }: { brand: Brand; article?: ArticleWithBrand; assets: MediaAsset[]; terms: WpTerms | null }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(saveArticle, null);
  const [title, setTitle] = useState(article?.title ?? "");
  const [slug, setSlug] = useState(article?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(article));
  const [html, setHtml] = useState(article?.content_html ?? "");
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? "");
  const [seoTitle, setSeoTitle] = useState(article?.seo_title ?? "");
  const [metaDesc, setMetaDesc] = useState(article?.meta_description ?? "");
  const [kw, setKw] = useState(article?.primary_keyword ?? "");
  const [kws, setKws] = useState((article?.secondary_keywords ?? []).join(", "));
  const [featured, setFeatured] = useState<MediaItem | null>((article?.featured_media as MediaItem | null) ?? null);
  const [categories, setCategories] = useState<TermRef[]>((article?.categories as TermRef[]) ?? []);
  const [tags, setTags] = useState<TermRef[]>((article?.tags as TermRef[]) ?? []);
  const [decision, setDecision] = useState(article?.decision ?? "new");
  const [rationale, setRationale] = useState(article?.rationale ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickResolve = useRef<((v: { url: string; alt: string } | null) => void) | null>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Saved");
      if (state.id && !article) router.push(`/blog/${state.id}`);
      else router.refresh();
    } else toast.error(state.error);
  }, [state, article, router]);

  const payload = JSON.stringify({
    id: article?.id, brand_id: brand.id, title, slug, content_html: html, excerpt, seo_title: seoTitle, meta_description: metaDesc,
    primary_keyword: kw, secondary_keywords: kws, featured_media: featured, categories, tags, decision, rationale,
  });
  const seoPreview = finalSeoTitle(seoTitle || null, title, brand.seo_suffix);
  const mdWarn = metaDescriptionWarning(metaDesc || null);

  function pickImage() {
    return new Promise<{ url: string; alt: string } | null>((resolve) => {
      pickResolve.current = resolve;
      setPickerOpen(true);
    });
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="title">Title (H1)</Label>
            <Input id="title" value={title} onChange={(e) => { setTitle(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} required className="text-lg" />
          </div>
          <RichEditor value={html} onChange={setHtml} onPickImage={pickImage} />
          <div className="hidden">
            <MediaPicker
              assets={assets}
              value={[]}
              onChange={() => {}}
              pickOne={(item) => { pickResolve.current?.({ url: item.url, alt: item.alt ?? "" }); pickResolve.current = null; }}
              openExternal={pickerOpen}
              onOpenChange={(o) => { setPickerOpen(o); if (!o && pickResolve.current) { pickResolve.current(null); pickResolve.current = null; } }}
            />
          </div>
        </div>

        <aside className="space-y-5">
          <div className="space-y-1">
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="excerpt">Excerpt</Label>
            <Textarea id="excerpt" rows={3} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Featured image</Label>
            {featured ? (
              <div className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={featured.url} alt={featured.alt ?? ""} className="aspect-video w-full rounded-md border object-cover" />
                <Input placeholder="Alt text" value={featured.alt ?? ""} onChange={(e) => setFeatured({ ...featured, alt: e.target.value })} />
                <button type="button" className="text-xs text-destructive underline" onClick={() => setFeatured(null)}>Remove</button>
              </div>
            ) : (
              <MediaPicker assets={assets} value={[]} onChange={() => {}} pickOne={(item) => setFeatured(item)} />
            )}
          </div>
          <TermSelect label="Categories" all={terms?.categories ?? []} value={categories} onChange={setCategories} brandId={brand.id} />
          <TermSelect label="Tags" all={terms?.tags ?? []} value={tags} onChange={setTags} brandId={brand.id} />

          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-sm font-medium">SEO (Yoast)</p>
            <div className="space-y-1">
              <Label htmlFor="seo_title">SEO title</Label>
              <Input id="seo_title" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder={title} />
              <p className="text-xs text-muted-foreground">Preview: {seoPreview} ({seoPreview.length} chars{seoPreview.length > 60 ? ", over 60" : ""})</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="meta_description">Meta description</Label>
              <Textarea id="meta_description" rows={3} value={metaDesc} onChange={(e) => setMetaDesc(e.target.value)} />
              <p className={`text-xs ${mdWarn ? "text-amber-700" : "text-muted-foreground"}`}>{metaDesc.length} chars{mdWarn ? ` · ${mdWarn}` : " · good length"}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="kw">Focus keyword</Label>
              <Input id="kw" value={kw} onChange={(e) => setKw(e.target.value)} />
              <SeoHints
                brandId={brand.id}
                articleId={article?.id ?? null}
                keyword={kw}
                slug={slug}
                title={title}
                onInsertLink={(url, text) => setHtml((h) => `${h}<p><a href="${url}">${text}</a></p>`)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="kws">Secondary keywords (comma separated)</Label>
              <Input id="kws" value={kws} onChange={(e) => setKws(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <Label htmlFor="decision">Decision</Label>
            <select id="decision" value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm">
              <option value="new">New blog post</option>
              <option value="rewrite">Rewrite of an existing page</option>
              <option value="optimize">Optimize an existing page</option>
            </select>
            <Textarea placeholder="Why this blog post / keyword?" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </div>
        </aside>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : article ? "Save changes" : "Create blog post"}</Button>
    </form>
  );
}
