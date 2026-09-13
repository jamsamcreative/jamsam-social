"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { refreshInsights } from "@/lib/insights/actions";

export function RefreshInsights({ postId }: { postId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await refreshInsights(postId);
          if (r.ok) {
            toast.success("Insights updated");
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      {pending ? "Refreshing..." : "Refresh insights"}
    </Button>
  );
}
