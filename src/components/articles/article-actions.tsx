"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pushArticle, publishArticle, syncArticle, archiveArticle, type ActionResult } from "@/lib/articles/actions";
import type { ArticleWithBrand } from "@/lib/articles/queries";
import { enqueueJob } from "@/lib/jobs/actions";

export function ArticleActions({ article, wpAdminUrl }: { article: ArticleWithBrand; wpAdminUrl: string | null }) {
  const [pending, start] = useTransition();
  const [pubOpen, setPubOpen] = useState(false);
  const [when, setWhen] = useState("");
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult>, okMsg: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(okMsg);
        for (const w of r.warnings ?? []) toast.warning(w);
        router.refresh();
      } else toast.error(r.error);
    });
  const s = article.status;
  return (
    <div className="flex flex-wrap gap-2">
      {s !== "archived" && (
        <Button
          disabled={pending}
          onClick={() => (s === "published" ? confirm("This article is live. Push the current content to WordPress?") : true) && run(() => pushArticle(article.id), "Pushed to WordPress")}
        >
          {pending ? "Working..." : article.wp_post_id ? "Push update to WordPress" : "Push to WordPress"}
        </Button>
      )}
      {s === "pushed_to_wp" && (
        <Button variant="outline" disabled={pending} onClick={() => setPubOpen(true)}>
          Publish
        </Button>
      )}
      {(s === "pushed_to_wp" || s === "published") && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await enqueueJob({
                brandId: article.brand_id,
                type: "promo",
                input: { article_id: article.id, scheduled_after: article.published_at ?? new Date().toISOString() },
              });
              if (r.ok) {
                toast.success("Promo post queued — see Jobs");
                router.push("/jobs");
              } else toast.error(r.error);
            })
          }
        >
          Promote on social
        </Button>
      )}
      {article.wp_post_id && (
        <Button variant="outline" disabled={pending} onClick={() => run(() => syncArticle(article.id), "Synced from WordPress")}>
          Sync from WP
        </Button>
      )}
      {wpAdminUrl && (
        <Button variant="ghost" nativeButton={false} render={<a href={wpAdminUrl} target="_blank" rel="noreferrer" />}>
          Open in wp-admin
        </Button>
      )}
      {s !== "archived" && (
        <Button variant="ghost" disabled={pending} onClick={() => confirm("Archive this article?") && run(() => archiveArticle(article.id), "Archived")}>
          Archive
        </Button>
      )}
      <Dialog open={pubOpen} onOpenChange={setPubOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish on WordPress</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Publish now, or pick a date to schedule it in WordPress ({article.brand.timezone}).</p>
            <div className="space-y-1">
              <Label htmlFor="when">Schedule for (optional)</Label>
              <Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPubOpen(false)}>Cancel</Button>
              <Button disabled={pending} onClick={() => { setPubOpen(false); run(() => publishArticle(article.id, when || undefined), when ? "Scheduled in WordPress" : "Published"); }}>
                {when ? "Schedule" : "Publish now"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
