"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { revokeConnectedApp } from "@/lib/oauth/actions";

export type ConnectedApp = { id: string; client_name: string | null; created_at: string; last_used_at: string | null };

export function ConnectedApps({ apps }: { apps: ConnectedApp[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (apps.length === 0) return <p className="text-sm text-muted-foreground">No apps connected via OAuth yet.</p>;
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {apps.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 p-3">
          <div>
            <p className="font-medium">{a.client_name ?? "Unnamed client"}</p>
            <p className="text-xs text-muted-foreground">
              Connected {new Date(a.created_at).toLocaleDateString()}
              {a.last_used_at ? ` · last used ${new Date(a.last_used_at).toLocaleString()}` : ""}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await revokeConnectedApp(a.id);
                if (r.ok) {
                  toast.success("Revoked");
                  router.refresh();
                } else toast.error(r.error);
              })
            }
          >
            Revoke
          </Button>
        </li>
      ))}
    </ul>
  );
}
