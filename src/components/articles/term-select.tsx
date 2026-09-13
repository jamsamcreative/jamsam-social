"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { refreshTerms } from "@/lib/articles/actions";
import type { TermRef } from "@/lib/database.types";

export function TermSelect({ label, all, value, onChange, brandId }: { label: string; all: TermRef[]; value: TermRef[]; onChange: (v: TermRef[]) => void; brandId: string }) {
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const shown = all.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  const toggle = (t: TermRef) => (value.some((v) => v.id === t.id) ? onChange(value.filter((v) => v.id !== t.id)) : onChange([...value, t]));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <button
          type="button"
          className="text-xs underline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await refreshTerms(brandId);
              if (r.ok) toast.success(`${label} refreshed; reload the page to see changes`);
              else toast.error(r.error);
            })
          }
        >
          {pending ? "Refreshing..." : "Refresh from WordPress"}
        </button>
      </div>
      {value.length > 0 && <p className="text-xs text-muted-foreground">Selected: {value.map((v) => v.name).join(", ")}</p>}
      {all.length === 0 ? (
        <p className="text-xs text-muted-foreground">None loaded. Connect WordPress and refresh.</p>
      ) : (
        <>
          <Input placeholder={`Search ${label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
            {shown.map((t) => (
              <label key={t.id} className="flex items-center gap-2">
                <input type="checkbox" checked={value.some((v) => v.id === t.id)} onChange={() => toggle(t)} /> {t.name}
              </label>
            ))}
          </div>
        </>
      )}
      <Button type="button" variant="ghost" size="xs" onClick={() => onChange([])} className="hidden" />
    </div>
  );
}
