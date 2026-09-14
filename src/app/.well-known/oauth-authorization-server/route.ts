import { env } from "@/lib/env";
import { metadata } from "@/lib/oauth/core";
import { json, preflight } from "@/lib/oauth/http";

export const GET = () => json(metadata(env.NEXT_PUBLIC_APP_URL).server);
export const OPTIONS = preflight;
