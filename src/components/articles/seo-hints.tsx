"use client";
import { useEffect, useState } from "react";
import { editorHints, type EditorHints } from "@/lib/seo/editor-actions";

/** Debounced cannibalization verdict + internal-link suggestions for the article form. */
export function SeoHints({ brandId, articleId, keyword, slug, title, onInsertLink }: { brandId: string; articleId: string | null; keyword: string; slug: string; title: string; onInsertLink: (url: string, text: string) => void }) {
  const [hints, setHints] = useState<EditorHints | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!keyword.trim()) return void setHints(null);
      setLoading(true);
      try {
        setHints(await editorHints(brandId, articleId, keyword, slug, title));
      } finally {
        setLoading(false);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [brandId, articleId, keyword, slug, title]);
  if (!keyword.trim()) return null;
  return (
    <div className="space-y-2 text-xs">
      {loading && !hints && <p className="text-muted-foreground">Checking…</p>}
      {hints && (
        <p className={hints.check.has_conflict ? "rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900" : "text-green-700"}>{hints.check.verdict}</p>
      )}
      {hints && hints.links.length > 0 && (
        <div>
          <p className="font-medium text-muted-foreground">Suggested internal links</p>
          <ul className="space-y-0.5">
            {hints.links.map((l) => (
              <li key={l.url}>
                <button type="button" className="underline" onClick={() => onInsertLink(l.url, l.title)}>{l.title}</button> <span className="text-muted-foreground">{l.slug}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hints && hints.check.live_site_check.pages_mirrored === 0 && <p className="text-muted-foreground">{hints.check.live_site_check.note}</p>}
    </div>
  );
}
