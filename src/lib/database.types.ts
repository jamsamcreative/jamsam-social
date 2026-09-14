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
  source: "manual" | "recycled" | "ai"; recycled_from: string | null; category_id: string | null;
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
export type TermRef = { id: number; name: string };
type ArticleRow = {
  id: string; brand_id: string; title: string; slug: string; content_html: string; excerpt: string | null;
  seo_title: string | null; meta_description: string | null; primary_keyword: string | null; secondary_keywords: string[];
  featured_media: Json | null; categories: Json; tags: Json; decision: "new" | "rewrite" | "optimize"; rationale: string | null;
  source: "manual" | "ai"; status: "draft" | "pushed_to_wp" | "published" | "archived";
  wp_post_id: number | null; wp_link: string | null; wp_status: string | null; pushed_at: string | null; published_at: string | null;
  last_error: string | null; created_by: string | null; created_at: string; updated_at: string;
};
type ArticleMediaMapRow = { id: string; brand_id: string; source_url: string; wp_media_id: number; wp_url: string; created_at: string };
type GenerationJobRow = {
  id: string; brand_id: string; type: "caption" | "article" | "promo" | "rewrite";
  status: "queued" | "claimed" | "running" | "completed" | "failed"; runner: "in_app" | "mcp";
  input: Json; result: Json | null; error: string | null; post_id: string | null; article_id: string | null;
  claimed_by: string | null; claimed_at: string | null; started_at: string | null; finished_at: string | null;
  attempts: number; model: string | null; input_tokens: number | null; output_tokens: number | null;
  created_by: string | null; created_at: string; updated_at: string;
};
type PostCategoryRow = {
  id: string; brand_id: string; name: string; slug: string; target_share: number; description: string | null;
  sort_order: number; created_at: string;
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
      posts: Table<PostRow, "brand_id" | "title">;
      post_targets: Table<PostTargetRow, "post_id" | "platform">;
      app_settings: Table<AppSettingRow, "key" | "value">;
      articles: Table<ArticleRow, "brand_id" | "title" | "slug">;
      article_media_map: Table<ArticleMediaMapRow, "brand_id" | "source_url" | "wp_media_id" | "wp_url">;
      generation_jobs: Table<GenerationJobRow, "brand_id" | "type" | "input">;
      post_categories: Table<PostCategoryRow, "brand_id" | "name" | "slug" | "target_share">;
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
      article_status: ArticleRow["status"];
      article_decision: ArticleRow["decision"];
      article_source: ArticleRow["source"];
      job_type: GenerationJobRow["type"];
      job_status: GenerationJobRow["status"];
      job_runner: GenerationJobRow["runner"];
    };
    CompositeTypes: Record<string, never>;
  };
};
