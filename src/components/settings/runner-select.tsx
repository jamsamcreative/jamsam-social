"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { setDefaultRunner } from "@/lib/settings/actions";
import { RUNNERS, RUNNER_LABELS, type RunnerSetting } from "@/lib/settings/models";

export function RunnerSelect({ value }: { value: RunnerSetting }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Default runner"
      value={value}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          const r = await setDefaultRunner(e.target.value);
          if (r.ok) toast.success("Default runner updated");
          else toast.error(r.error);
        })
      }
      className="w-80 rounded-md border bg-background px-2 py-1.5 text-sm"
    >
      {RUNNERS.map((r) => (
        <option key={r} value={r}>
          {RUNNER_LABELS[r]}
        </option>
      ))}
    </select>
  );
}
