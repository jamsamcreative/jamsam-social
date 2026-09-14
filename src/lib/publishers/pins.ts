import { createAdminSupabase } from "@/lib/supabase/admin";
import { withPinterestToken } from "@/lib/pinterest/token";
import { createPin } from "@/lib/pinterest/client";
import { buildPinPayload } from "@/lib/pins/rules";
import type { Database } from "@/lib/database.types";

type Pin = Database["public"]["Tables"]["pins"]["Row"];
export const PIN_MAX_ATTEMPTS = 3;
type PinPatch = Partial<Pick<Pin, "status" | "external_id" | "external_url" | "published_at" | "error" | "claimed_at">>;

export type PinRunDeps = {
  token: (brandId: string) => Promise<string | null>;
  publish: (token: string, payload: ReturnType<typeof buildPinPayload>) => Promise<{ id: string; url: string }>;
  save: (pinId: string, patch: PinPatch) => Promise<void>;
};

/** One claimed pin: publish or record failure; retry until attempts hit the cap. */
export async function processPin(pin: Pin, deps: PinRunDeps): Promise<"published" | "failed" | "retry"> {
  const fail = async (message: string) => {
    const permanent = pin.attempts >= PIN_MAX_ATTEMPTS;
    await deps.save(pin.id, { status: permanent ? "failed" : "approved", error: message, claimed_at: null });
    return permanent ? ("failed" as const) : ("retry" as const);
  };
  try {
    const token = await deps.token(pin.brand_id);
    if (!token) return fail("Pinterest is not connected for this brand");
    const r = await deps.publish(token, buildPinPayload(pin));
    await deps.save(pin.id, { status: "published", external_id: r.id, external_url: r.url, published_at: new Date().toISOString(), error: null, claimed_at: null });
    return "published";
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export function realPinDeps(): PinRunDeps {
  const admin = createAdminSupabase();
  return {
    token: async (brandId) => (await withPinterestToken(brandId))?.token ?? null,
    publish: (t, p) => createPin(t, p),
    save: async (id, patch) => {
      await admin.from("pins").update(patch).eq("id", id);
    },
  };
}

export async function runPinPublishCycle() {
  const admin = createAdminSupabase();
  const { data: reset } = await admin.rpc("reset_stale_pins");
  const { data: claimed, error } = await admin.rpc("claim_due_pins", { max_rows: 10 });
  if (error) throw new Error(error.message);
  const deps = realPinDeps();
  const counts = { reset: reset ?? 0, claimed: claimed?.length ?? 0, published: 0, failed: 0, retried: 0 };
  for (const p of claimed ?? []) {
    const r = await processPin(p, deps);
    if (r === "published") counts.published++;
    else if (r === "failed") counts.failed++;
    else counts.retried++;
  }
  return counts;
}
