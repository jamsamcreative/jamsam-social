"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createSupabaseOauthStore } from "./store";
import { validateAuthorize, issueCode, type AuthorizeParams } from "./server";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Consent granted: mint the code and send the browser back to the client. */
export async function approveAuthorization(params: AuthorizeParams): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const store = createSupabaseOauthStore();
  let location: string;
  try {
    const { params: p } = await validateAuthorize(store, params);
    location = await issueCode(store, p, user.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  redirect(location);
}

export async function revokeConnectedApp(tokenId: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const store = createSupabaseOauthStore();
  const mine = (await store.listTokensForUser(user.id)).some((t) => t.id === tokenId);
  if (!mine) return { ok: false, error: "Not found" };
  await store.revokeToken(tokenId);
  revalidatePath("/settings");
  return { ok: true };
}
