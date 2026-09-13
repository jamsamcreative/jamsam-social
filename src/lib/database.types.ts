// Hand-written to match supabase/migrations/0001_foundation.sql. Regenerate with `npm run db:types` after `npx supabase login && npx supabase link`.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type BrandRow = {
  id: string; slug: string; name: string; website_url: string | null; timezone: string;
  seo_suffix: string | null; active: boolean; created_at: string; updated_at: string;
};
type ConnectionRow = {
  id: string; brand_id: string; provider: "wordpress" | "meta" | "pinterest" | "semrush"; config: Json; secret: string | null;
  status: "not_connected" | "connected" | "failing"; last_checked: string | null; last_error: string | null;
  created_at: string; updated_at: string;
};
type GuidelineRow = {
  id: string; brand_id: string; kind: "social_style" | "social_post_spec" | "blog_style" | "blog_post_spec" | "pin_spec";
  body_md: string; updated_by: string | null; updated_at: string;
};
type MediaRow = {
  id: string; brand_id: string; storage_path: string; public_url: string; filename: string; mime_type: string;
  width: number | null; height: number | null; alt_text: string | null; tags: string[]; uploaded_by: string | null; created_at: string;
};
export type MediaItem = { url: string; alt?: string | null; media_asset_id?: string | null };
type PostRow = {
  id: string; brand_id: string; title: string; link_url: string | null; media: Json;
  source: "manual" | "recycled" | "ai"; recycled_from: string | null;
  status: "draft" | "pending_approval" | "approved" | "publishing" | "published" | "failed" | "archived";
  created_by: string | null; approved_by: string | null; approved_at: string | null; created_at: string; updated_at: string;
};
type PostTargetRow = {
  id: string; post_id: string; platform: "facebook" | "instagram"; caption: string; scheduled_at: string | null;
  status: "pending" | "publishing" | "published" | "failed"; external_id: string | null; external_url: string | null;
  published_at: string | null; error: string | null; attempts: number; claimed_at: string | null;
  insights: Json | null; insights_fetched_at: string | null; created_at: string; updated_at: string;
};
type AppSettingRow = { key: string; value: string };
type Table<R, Req extends keyof R> = {
  Row: R;
  Insert: Pick<R, Req> & Partial<Omit<R, Req>>;
  Update: Partial<R>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      brands: Table<BrandRow, "slug" | "name">;
      brand_connections: Table<ConnectionRow, "brand_id" | "provider">;
      brand_guidelines: Table<GuidelineRow, "brand_id" | "kind">;
      media_assets: Table<MediaRow, "brand_id" | "storage_path" | "public_url" | "filename" | "mime_type">;
      posts: Table<PostRow, "brand_id" | "title">;
      post_targets: Table<PostTargetRow, "post_id" | "platform">;
      app_settings: Table<AppSettingRow, "key" | "value">;
    };
    Views: Record<string, never>;
    Functions: {
      claim_due_targets: { Args: { max_rows?: number }; Returns: PostTargetRow[] };
      reset_stale_targets: { Args: Record<string, never>; Returns: number };
    };
    Enums: {
      connection_provider: ConnectionRow["provider"];
      connection_status: ConnectionRow["status"];
      guideline_kind: GuidelineRow["kind"];
      post_status: PostRow["status"];
      post_source: PostRow["source"];
      social_platform: PostTargetRow["platform"];
      target_status: PostTargetRow["status"];
    };
    CompositeTypes: Record<string, never>;
  };
};
