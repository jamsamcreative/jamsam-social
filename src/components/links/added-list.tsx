import { Button } from "@/components/ui/button";
import type { AddedRow } from "@/lib/links/queries";

type Props = { rows: AddedRow[]; disabled: boolean; onUndo: (id: string) => void };

/** Collapsible history of approved links; Undo shares the page's single `disabled` flag with Scan/Approve/Reject. */
export function AddedList({ rows, disabled, onUndo }: Props) {
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer text-lg font-semibold">Links added ({rows.length})</summary>
      <div className="mt-3 space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No links added yet.</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <div className="min-w-0">
              <p className="truncate">
                <span className="font-medium">{r.orphanTitle}</span> <span className="text-muted-foreground">← {r.hostTitle}</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                &ldquo;{r.phrase}&rdquo; · {r.brandName} · {new Date(r.appliedAt).toLocaleString()}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => onUndo(r.id)}>Undo</Button>
          </div>
        ))}
      </div>
    </details>
  );
}
