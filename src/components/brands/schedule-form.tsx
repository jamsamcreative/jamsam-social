"use client";
import { useActionState } from "react";
import { saveScheduleAction, type ActionResult } from "@/lib/plan/actions";
import type { BrandSchedule } from "@/lib/plan/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ScheduleForm({ brandId, schedule, sampleCount }: { brandId: string; schedule: BrandSchedule | null; sampleCount: number }) {
  const [state, action, pending] = useActionState(saveScheduleAction.bind(null, brandId), null as ActionResult | null);
  const time = (dow: number, platform: "facebook" | "instagram") => schedule?.slots.find((s) => s.dow === dow && s.platform === platform)?.time ?? "";
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-[4rem_1fr_1fr] gap-2 text-sm">
        <div />
        <div className="font-medium">Facebook</div>
        <div className="font-medium">Instagram</div>
        {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
          <div key={dow} className="contents">
            <Label className="self-center">{DAYS[dow]}</Label>
            <Input name={`fb_${dow}`} type="time" defaultValue={time(dow, "facebook")} aria-label={`Facebook ${DAYS[dow]}`} />
            <Input name={`ig_${dow}`} type="time" defaultValue={time(dow, "instagram")} aria-label={`Instagram ${DAYS[dow]}`} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1"><Label htmlFor="recycle_cap">Recycles per week</Label><Input id="recycle_cap" name="recycle_cap" type="number" defaultValue={schedule?.recycle_cap ?? 3} /></div>
        <div className="space-y-1"><Label htmlFor="rest_days_min">Rest at least (days)</Label><Input id="rest_days_min" name="rest_days_min" type="number" defaultValue={schedule?.rest_days_min ?? 60} /></div>
        <div className="space-y-1"><Label htmlFor="rest_days_max">Preferred by (days)</Label><Input id="rest_days_max" name="rest_days_max" type="number" defaultValue={schedule?.rest_days_max ?? 90} /></div>
      </div>
      <p className="text-xs text-muted-foreground">
        {sampleCount >= 50 ? `Times are refined from ${sampleCount} measured posts; blank days are never used.` : `Times come from this schedule until the brand has 50 measured posts (${sampleCount} so far).`}
      </p>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-muted-foreground">Schedule saved</p>}
      <Button type="submit" disabled={pending}>Save schedule</Button>
    </form>
  );
}
