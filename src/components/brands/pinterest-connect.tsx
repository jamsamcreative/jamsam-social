"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncBoards } from "@/lib/pins/actions";

type Board = { board_id: string; name: string; pin_count: number | null; pins_in_app: number; measured: number; median_impressions: number | null };

export function PinterestConnect({ brandId, slug, oauth, connected, boards }: { brandId: string; slug: string; oauth: boolean; connected: { username?: string } | null; boards: Board[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {oauth ? (
          <Button type="button" nativeButton={false} render={<a href={`/api/auth/pinterest/start?brand=${encodeURIComponent(slug)}`} />}>{connected ? "Reconnect Pinterest" : "Connect Pinterest"}</Button>
        ) : (
          <p className="text-xs text-muted-foreground">PINTEREST_APP_ID/SECRET are not configured, so paste a token below.</p>
        )}
        {connected && (
          <>
            <span className="text-sm">@{connected.username ?? "connected"}</span>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await syncBoards(brandId); if (r.ok) { toast.success(r.warnings?.[0] ?? "Synced"); router.refresh(); } else toast.error(r.error); })}>Sync boards</Button>
          </>
        )}
      </div>
      {boards.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground"><tr><th className="p-1">Board</th><th className="p-1">Pins on Pinterest</th><th className="p-1">Pins here</th><th className="p-1">Measured</th><th className="p-1">Median impressions</th></tr></thead>
          <tbody>{boards.map((b) => <tr key={b.board_id} className="border-t"><td className="p-1">{b.name}</td><td className="p-1">{b.pin_count ?? "—"}</td><td className="p-1">{b.pins_in_app}</td><td className="p-1">{b.measured}</td><td className="p-1">{b.median_impressions ?? "—"}</td></tr>)}</tbody>
        </table>
      )}
      {oauth && <p className="text-xs text-muted-foreground">Or paste an access token below (expires in 30 days; OAuth tokens refresh themselves).</p>}
    </div>
  );
}
