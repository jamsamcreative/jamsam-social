"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { choosePage } from "@/lib/meta/actions";

export function PickForm({ slug, pages }: { slug: string; pages: { id: string; name: string; ig_username: string | null }[] }) {
  const [sel, setSel] = useState(pages[0]?.id ?? "");
  const [pending, start] = useTransition();
  return (
    <form action={() => start(() => choosePage(slug, sel))} className="space-y-4">
      <ul className="divide-y rounded-md border">
        {pages.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-3 p-3">
              <input type="radio" name="page" value={p.id} checked={sel === p.id} onChange={() => setSel(p.id)} />
              <span className="flex-1">
                <span className="font-medium">{p.name}</span>
                <span className="block text-xs text-muted-foreground">{p.ig_username ? `Instagram @${p.ig_username}` : "No Instagram linked"}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <Button type="submit" disabled={pending || !sel}>
        {pending ? "Connecting..." : "Connect this Page"}
      </Button>
    </form>
  );
}
