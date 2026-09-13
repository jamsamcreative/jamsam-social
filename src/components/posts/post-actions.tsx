"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { submitForApproval, approvePost, rejectPost, publishNow, recyclePost, archivePost, retryTarget, type ActionResult } from "@/lib/posts/actions";
import type { PostWithTargets } from "@/lib/posts/queries";

export function PostActions({ post }: { post: PostWithTargets }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult>, okMsg: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(okMsg);
        router.refresh();
      } else toast.error(r.error);
    });
  const s = post.status;
  const failed = post.targets.filter((t) => t.status === "failed");
  return (
    <div className="flex flex-wrap gap-2">
      {s === "draft" && (
        <Button disabled={pending} onClick={() => run(() => submitForApproval(post.id), "Submitted for approval")}>
          Submit for approval
        </Button>
      )}
      {s === "pending_approval" && (
        <>
          <Button disabled={pending} onClick={() => run(() => approvePost(post.id), "Approved and scheduled")}>
            Approve
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => run(() => rejectPost(post.id), "Sent back to draft")}>
            Send back
          </Button>
        </>
      )}
      {["draft", "pending_approval", "approved", "failed"].includes(s) && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => confirm("Publish to all enabled platforms within the next minute?") && run(() => publishNow(post.id), "Publishing shortly")}
        >
          Publish now
        </Button>
      )}
      {s === "published" && (
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await recyclePost(post.id);
              if (r && !r.ok) toast.error(r.error);
            })
          }
        >
          Recycle
        </Button>
      )}
      {failed.map((t) => (
        <Button key={t.id} variant="outline" disabled={pending} onClick={() => run(() => retryTarget(t.id), `Retrying ${t.platform}`)}>
          Retry {t.platform}
        </Button>
      ))}
      {s !== "publishing" && s !== "archived" && (
        <Button variant="ghost" disabled={pending} onClick={() => confirm("Archive this post?") && run(() => archivePost(post.id), "Archived")}>
          Archive
        </Button>
      )}
    </div>
  );
}
