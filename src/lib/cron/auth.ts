import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export function isCronAuthorized(req: Request): boolean {
  const h = req.headers.get("authorization") ?? "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : "";
  const want = env.CRON_SECRET;
  return given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
}
