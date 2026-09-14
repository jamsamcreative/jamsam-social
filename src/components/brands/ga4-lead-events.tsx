"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { listGa4KeyEvents } from "@/lib/connections/metrics-actions";

/** Multi-select of the property's GA4 key events that count as a website lead. Serialises to the hidden `lead_events` field. */
export function Ga4LeadEvents({ initial, propertyInputId }: { initial: string[]; propertyInputId: string }) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [options, setOptions] = useState<string[]>(initial);
  const [pending, start] = useTransition();
  const load = () =>
    start(async () => {
      const pid = (document.getElementById(propertyInputId) as HTMLInputElement | null)?.value ?? "";
      const r = await listGa4KeyEvents(pid);
      if (!r.ok) return void toast.error(r.error);
      setOptions(Array.from(new Set([...r.data, ...selected])));
      if (r.data.length === 0) toast.info("This property has no key events yet. Mark a conversion as a key event in GA4 → Admin → Events.");
    });
  const toggle = (name: string) => setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));
  return (
    <div className="space-y-2">
      <input type="hidden" name="lead_events" value={JSON.stringify(selected)} />
      <div className="flex items-center justify-between">
        <Label>Lead events (GA4 key events that count as a website lead)</Label>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={load}>
          {pending ? "Loading…" : "Load key events"}
        </Button>
      </div>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">Save the property ID, then load key events.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
              <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} /> {o}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
