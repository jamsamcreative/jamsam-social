"use server";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { encryptJson, decryptJson } from "@/lib/crypto";
import type { Json } from "@/lib/database.types";
import { PROVIDERS, type Provider, type TestResult } from "./index";
import { enrichMetaConfig, type MetaConfig, type MetaSecret } from "./meta";

export type ActionResult = { ok: true; detail: string } | { ok: false; error: string };

async function requireUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user;
}

/** Runs provider.test and writes status/last_error back to the row. */
export async function runConnectionTest(connectionId: string): Promise<TestResult> {
  const admin = createAdminSupabase();
  const { data: row, error } = await admin
    .from("brand_connections")
    .select("id,brand_id,provider,config,secret")
    .eq("id", connectionId)
    .single();
  if (error || !row) return { ok: false, error: "Connection not found" };
  if (!row.secret) return { ok: false, error: "No credentials saved yet" };

  const provider = PROVIDERS[row.provider as Provider];
  const secret = decryptJson(row.secret);
  const result = await provider.test(row.config, secret);

  let config: Json = row.config;
  if (result.ok && row.provider === "meta") {
    config = (await enrichMetaConfig(row.config as MetaConfig, secret as MetaSecret)) as Json;
  }
  if (result.ok && result.configPatch) {
    const patch = Object.fromEntries(Object.entries(result.configPatch).filter(([, v]) => v !== undefined));
    config = { ...(config as Record<string, Json>), ...(patch as Record<string, Json>) } as Json;
  }

  await admin
    .from("brand_connections")
    .update({
      config,
      status: result.ok ? "connected" : "failing",
      last_checked: new Date().toISOString(),
      last_error: result.ok ? null : result.error,
    })
    .eq("id", row.id);

  return result;
}

export async function saveAndTestConnection(
  brandId: string,
  provider: Provider,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireUser();
  } catch {
    return { ok: false, error: "Not signed in" };
  }

  const def = PROVIDERS[provider];
  const raw = Object.fromEntries(formData) as Record<string, string>;

  const config = def.configSchema.safeParse(raw);
  if (!config.success) return { ok: false, error: config.error.issues[0]?.message ?? "Invalid settings" };

  // Secret fields are optional on re-save: blank means "keep the existing secret".
  const admin = createAdminSupabase();
  const { data: existing } = await admin
    .from("brand_connections")
    .select("id,secret")
    .eq("brand_id", brandId)
    .eq("provider", provider)
    .maybeSingle();

  const secretKeys = Object.keys((def.secretSchema as z.ZodObject<z.ZodRawShape>).shape);
  const secretFieldsProvided = secretKeys.some((k) => raw[k]?.trim());
  let secretCipher: string | null = existing?.secret ?? null;
  if (secretFieldsProvided) {
    // Drop blank optional secret fields so "" does not overwrite e.g. an optional refresh token.
    const provided = Object.fromEntries(secretKeys.filter((k) => raw[k]?.trim()).map((k) => [k, raw[k].trim()]));
    const secret = def.secretSchema.safeParse(provided);
    if (!secret.success) return { ok: false, error: secret.error.issues[0]?.message ?? "Invalid credentials" };
    secretCipher = encryptJson(secret.data);
  }
  // Providers with no secret fields (service-account based) store an empty secret so the row is "complete".
  if (!secretCipher && secretKeys.length === 0) secretCipher = encryptJson({});
  if (!secretCipher) return { ok: false, error: "Credentials are required" };

  const { data: saved, error } = await admin
    .from("brand_connections")
    .upsert(
      { brand_id: brandId, provider, config: config.data as Json, secret: secretCipher, status: "not_connected" },
      { onConflict: "brand_id,provider" },
    )
    .select("id")
    .single();
  if (error || !saved) return { ok: false, error: error?.message ?? "Could not save connection" };

  const result = await runConnectionTest(saved.id);
  revalidatePath(`/brands`, "layout");
  revalidatePath("/dashboard");
  return result;
}
