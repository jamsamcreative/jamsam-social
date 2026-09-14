"use server";
import { createServerSupabase } from "@/lib/supabase/server";
import { serviceAccount, googleAccessToken, GA4_SCOPE } from "@/lib/google/auth";
import { ga4ListKeyEvents } from "@/lib/google/ga4";
import { metaAdAccounts } from "@/lib/meta/ads";

type R<T> = { ok: true; data: T } | { ok: false; error: string };

async function signedIn() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user);
}

/** The service-account email clients must grant access to (safe to show; it's not a secret). */
export async function getServiceAccountEmail(): Promise<string | null> {
  return serviceAccount()?.email ?? null;
}

export async function listGa4KeyEvents(propertyId: string): Promise<R<string[]>> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in" };
  if (!/^\d+$/.test(propertyId)) return { ok: false, error: "Enter the numeric GA4 property ID first" };
  try {
    const token = await googleAccessToken([GA4_SCOPE]);
    const events = await ga4ListKeyEvents(propertyId, { token });
    return { ok: true, data: events.map((e) => e.eventName) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function findMetaAdAccounts(token: string): Promise<R<{ id: string; name: string; currency: string }[]>> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in" };
  if (!token.trim()) return { ok: false, error: "Paste a Marketing API token first" };
  try {
    return { ok: true, data: await metaAdAccounts(token.trim()) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
