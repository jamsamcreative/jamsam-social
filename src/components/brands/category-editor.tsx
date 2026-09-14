"use client";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCategory, deleteCategory, type ActionResult } from "@/lib/categories/actions";
import type { PostCategory } from "@/lib/categories/queries";
import type { ContentMix } from "@/lib/ai/content-mix";

function Row({ brandId, c, actual }: { brandId: string; c: PostCategory | null; actual: number | null }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveCategory.bind(null, brandId, c?.id ?? null), null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Saved");
      router.refresh();
      if (!c) formRef.current?.reset(); // the "add" row clears for the next category
    } else toast.error(state.error);
  }, [state, router, c]);
  const idFor = (f: string) => `${c?.id ?? "new"}-${f}`;
  return (
    <form ref={formRef} action={action} className="grid items-end gap-2 rounded-lg border p-3 md:grid-cols-[1fr_100px_2fr_80px_auto]">
      <div className="space-y-1">
        <Label htmlFor={idFor("name")}>Name</Label>
        <Input id={idFor("name")} name="name" defaultValue={c?.name ?? ""} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor={idFor("target")}>Target %</Label>
        <Input id={idFor("target")} name="target_percent" type="number" min={0} max={100} defaultValue={c ? Math.round(c.target_share * 100) : ""} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor={idFor("desc")}>What qualifies</Label>
        <Input id={idFor("desc")} name="description" defaultValue={c?.description ?? ""} placeholder="Shown to the generator" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={idFor("order")}>Order</Label>
        <Input id={idFor("order")} name="sort_order" type="number" min={0} defaultValue={c?.sort_order ?? 0} />
      </div>
      <div className="flex gap-1">
        <Button size="sm" disabled={pending} type="submit">
          {c ? "Save" : "Add"}
        </Button>
        {c && (
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={async () => {
              const r = await deleteCategory(c.id);
              if (r.ok) router.refresh();
              else toast.error(r.error);
            }}
          >
            Delete
          </Button>
        )}
      </div>
      {c && actual !== null && (
        <div className="md:col-span-5">
          <div className="h-2 w-full rounded bg-muted">
            <div className="h-2 rounded bg-foreground" style={{ width: `${Math.min(100, Math.round(actual * 100))}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Actual {Math.round(actual * 100)}% · target {Math.round(c.target_share * 100)}%
          </p>
        </div>
      )}
    </form>
  );
}

export function CategoryEditor({ brandId, categories, mix }: { brandId: string; categories: PostCategory[]; mix: ContentMix }) {
  const actualFor = (id: string) => mix.categories.find((m) => m.id === id)?.actual_share ?? 0;
  return (
    <div className="space-y-3">
      {categories.map((c) => (
        <Row key={c.id} brandId={brandId} c={c} actual={actualFor(c.id)} />
      ))}
      <Row brandId={brandId} c={null} actual={null} />
      {mix.favour_next && (
        <p className="text-sm">
          Next post should favour: <span className="font-medium">{mix.favour_next}</span>
        </p>
      )}
    </div>
  );
}
