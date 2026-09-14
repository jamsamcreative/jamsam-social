"use client";
import { useState, type ReactNode } from "react";

/** Every chart ships its table view; this toggles it. */
export function ShowNumbers({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button type="button" className="text-xs underline text-muted-foreground" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide the numbers" : "Show the numbers"}
      </button>
      {open && <div className="mt-2 overflow-x-auto">{children}</div>}
    </div>
  );
}
