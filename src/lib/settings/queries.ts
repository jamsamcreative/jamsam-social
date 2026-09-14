import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function getSetting(key: string): Promise<string | null> {
  const { data } = await createAdminSupabase().from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

import { DEFAULT_RUNNER, RUNNERS, type RunnerSetting } from "./models";
export async function getDefaultRunner(): Promise<RunnerSetting> {
  const v = await getSetting("default_runner");
  return (RUNNERS as readonly string[]).includes(v ?? "") ? (v as RunnerSetting) : DEFAULT_RUNNER;
}
