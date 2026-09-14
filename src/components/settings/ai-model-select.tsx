"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { setAiModel } from "@/lib/settings/actions";
import { AI_MODELS } from "@/lib/settings/models";

export function AiModelSelect({ value }: { value: string }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="AI model"
      value={value}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          const r = await setAiModel(e.target.value);
          if (r.ok) toast.success("Model updated");
          else toast.error(r.error);
        })
      }
      className="w-64 rounded-md border bg-background px-2 py-1.5 text-sm"
    >
      {AI_MODELS.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}
