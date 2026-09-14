"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setAiModel } from "@/lib/settings/actions";
import { AI_MODELS } from "@/lib/settings/models";

export function AiModelSelect({ value }: { value: string }) {
  const [pending, start] = useTransition();
  return (
    <Select
      value={value}
      disabled={pending}
      onValueChange={(v) =>
        start(async () => {
          if (!v) return;
          const r = await setAiModel(v);
          if (r.ok) toast.success("Model updated");
          else toast.error(r.error);
        })
      }
    >
      <SelectTrigger className="w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AI_MODELS.map((m) => (
          <SelectItem key={m} value={m}>
            {m}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
