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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      connection_provider: ConnectionRow["provider"];
      connection_status: ConnectionRow["status"];
      guideline_kind: GuidelineRow["kind"];
    };
    CompositeTypes: Record<string, never>;
  };
};
