"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { unmarkSubmittedToSearchConsole } from "@/lib/articles/actions";

export function GscStatus({ articleId, submittedAt, formatted }: { articleId: string; submittedAt: string | null; formatted: string | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!submittedAt) return null;
  return (
    <span>
      {" "}· Submitted to Search Console {formatted}{" "}
      <button
        type="button"
        disabled={pending}
        className="underline disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const r = await unmarkSubmittedToSearchConsole(articleId);
            if (r.ok) {
              toast.success("Back in the Search Console queue");
              router.refresh();
            } else toast.error(r.error);
          })
        }
      >
        Not submitted
      </button>
    </span>
  );
}
