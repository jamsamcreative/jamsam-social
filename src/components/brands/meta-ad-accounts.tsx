"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { findMetaAdAccounts } from "@/lib/connections/metrics-actions";

/** "Find ad accounts" using the token typed into the form; picking one fills the ad_account_id input. */
export function MetaAdAccounts({ tokenInputId, accountInputId }: { tokenInputId: string; accountInputId: string }) {
  const [accounts, setAccounts] = useState<{ id: string; name: string; currency: string }[]>([]);
  const [pending, start] = useTransition();
  const find = () =>
    start(async () => {
      const token = (document.getElementById(tokenInputId) as HTMLInputElement | null)?.value ?? "";
      const r = await findMetaAdAccounts(token);
      if (!r.ok) return void toast.error(r.error);
      setAccounts(r.data);
      if (r.data.length === 0) toast.info("No ad accounts visible to this token. It needs ads_read and access to the client's ad account.");
    });
  const pick = (id: string) => {
    const input = document.getElementById(accountInputId) as HTMLInputElement | null;
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, id);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={find}>
        {pending ? "Looking…" : "Find ad accounts"}
      </Button>
      {accounts.length > 0 && (
        <ul className="space-y-1 text-xs">
          {accounts.map((a) => (
            <li key={a.id}>
              <button type="button" className="underline" onClick={() => pick(a.id)}>
                {a.name}
              </button>{" "}
              <span className="text-muted-foreground">
                {a.id} · {a.currency}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
