import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { withPinterestToken } from "@/lib/pinterest/token";
import { listBoards } from "@/lib/pinterest/client";

/** Replace the brand's pin_boards with the live list. */
export async function syncBoardsForBrand(brandId: string): Promise<{ boards: number }> {
  const t = await withPinterestToken(brandId);
  if (!t) throw new Error("Pinterest is not connected");
  const boards = await listBoards(t.token);
  const admin = createAdminSupabase();
  const now = new Date().toISOString();
  if (boards.length) {
    const { error } = await admin.from("pin_boards").upsert(boards.map((b) => ({ brand_id: brandId, board_id: b.id, name: b.name, privacy: b.privacy ?? null, pin_count: b.pin_count ?? null, synced_at: now })), { onConflict: "brand_id,board_id" });
    if (error) throw new Error(error.message);
  }
  await admin.from("pin_boards").delete().eq("brand_id", brandId).lt("synced_at", now);
  return { boards: boards.length };
}
