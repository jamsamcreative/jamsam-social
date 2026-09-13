import type { Database } from "@/lib/database.types";

export type PostStatus = Database["public"]["Enums"]["post_status"];
export type TargetStatus = Database["public"]["Enums"]["target_status"];
export type Platform = Database["public"]["Enums"]["social_platform"];

export const PLATFORMS: Platform[] = ["facebook", "instagram"];
export const PLATFORM_LABELS: Record<Platform, string> = { facebook: "Facebook", instagram: "Instagram" };
export const MAX_MEDIA = 10;
export const MAX_ATTEMPTS = 3;

export function derivePostStatus(current: PostStatus, targets: { status: TargetStatus }[]): PostStatus {
  if (["draft", "pending_approval", "archived"].includes(current)) return current;
  if (targets.length === 0) return current;
  if (targets.some((t) => t.status === "publishing")) return "publishing";
  if (targets.every((t) => t.status === "published")) return "published";
  if (targets.some((t) => t.status === "pending")) return "approved";
  if (targets.some((t) => t.status === "failed")) return "failed";
  return current;
}

export type SubmitTarget = { platform: Platform; enabled: boolean; caption: string; scheduled_at: string | null };

export function validateForSubmit(input: { media: unknown[]; targets: SubmitTarget[] }): string | null {
  if (input.media.length > MAX_MEDIA) return `A post can have at most ${MAX_MEDIA} images`;
  const enabled = input.targets.filter((t) => t.enabled);
  if (enabled.length === 0) return "Enable at least one platform";
  for (const t of enabled) {
    const label = PLATFORM_LABELS[t.platform];
    if (!t.caption.trim()) return `${label} needs a caption`;
    if (!t.scheduled_at) return `${label} needs a schedule time`;
    if (t.platform === "instagram" && input.media.length === 0) return "Instagram posts need at least one image";
  }
  return null;
}
