import { buildGbpPost, gbpCreatePost, gbpAccessToken } from "@/lib/google/gbp";
import type { PublishInput, PublishResult } from "./types";

export async function publishToGbp(locationName: string, refreshToken: string, input: PublishInput): Promise<PublishResult> {
  const token = await gbpAccessToken(refreshToken);
  const r = await gbpCreatePost(locationName, buildGbpPost(input), { token });
  return { external_id: r.name, external_url: r.searchUrl };
}
