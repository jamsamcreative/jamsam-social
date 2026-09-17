export type PageLite = { id: string; wp_id: number; type: "post" | "page"; slug: string; url: string; title: string; focus_keyword: string | null; content_text: string; modified_at: string | null };
export type LinkEdge = { from_page_id: string; to_page_id: string; href: string; anchor_text: string };
export type Suggestion = { orphan_page_id: string; host_page_id: string; phrase: string; context: string };
export type NoneReason = "site-wide term" | "only inside itself or in posts that already link here" | "no other post mentions the topic";
export type NoneVerdict = { orphan_page_id: string; reason: NoneReason; phrases_tried: string[] };
export type Orphan = { page: PageLite; utility: boolean };
