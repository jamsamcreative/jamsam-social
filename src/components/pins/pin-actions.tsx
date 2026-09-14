"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { submitPin, approvePin, rejectPin, publishPinNow, retryPin, archivePin, type ActionResult } from "@/lib/pins/actions";
import type { Pin } from "@/lib/pins/queries";

export function PinActions({ pin }: { pin: Pin }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        for (const w of r.warnings ?? []) toast.warning(w);
        router.refresh();
      } else toast.error(r.error);
    });
  const s = pin.status;
  return (
    <div className="flex flex-wrap gap-2">
      {s === "draft" && <Button disabled={pending} onClick={() => run(() => submitPin(pin.id), "Submitted for approval")}>Submit for approval</Button>}
      {s === "pending_approval" && (
        <>
          <Button disabled={pending} onClick={() => run(() => approvePin(pin.id), "Approved — will publish at the scheduled time")}>Approve</Button>
          <Button variant="outline" disabled={pending} onClick={() => run(() => rejectPin(pin.id), "Sent back to draft")}>Send back</Button>
        </>
      )}
      {["draft", "pending_approval", "approved", "failed"].includes(s) && (
        <Button variant="outline" disabled={pending} onClick={() => confirm("Publish this pin to Pinterest within the next minute?") && run(() => publishPinNow(pin.id), "Publishing shortly")}>Publish now</Button>
      )}
      {s === "failed" && <Button variant="outline" disabled={pending} onClick={() => run(() => retryPin(pin.id), "Retrying")}>Retry</Button>}
      {pin.external_url && <Button variant="ghost" nativeButton={false} render={<a href={pin.external_url} target="_blank" rel="noreferrer" />}>View on Pinterest</Button>}
      {s !== "archived" && s !== "publishing" && <Button variant="ghost" disabled={pending} onClick={() => confirm("Archive this pin?") && run(() => archivePin(pin.id), "Archived")}>Archive</Button>}
    </div>
  );
}
