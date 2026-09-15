import { z } from "zod";
import type { Database } from "@/lib/database.types";

export type JobType = Database["public"]["Enums"]["job_type"];
export type JobStatus = Database["public"]["Enums"]["job_status"];
export type JobRunner = Database["public"]["Enums"]["job_runner"];
export const JOB_TYPES: JobType[] = ["caption", "article", "promo", "rewrite", "seo_cluster", "pin"];

const uuid = z.string().uuid();

const lane = z.enum(["new_page", "recycle", "promo", "filler"]);
/** Weekly Plan metadata carried on a planned post (`posts.plan`) and through promo jobs to `create_post`. */
export const planMetaSchema = z.object({ week_start: z.string(), lane, reason: z.string(), candidate_id: z.string(), touched: z.boolean().default(false) });
export type PlanMeta = z.infer<typeof planMetaSchema>;

export const captionInputSchema = z.object({ post_id: uuid, plan: z.object({ lane, reason: z.string() }).optional() });
export const articleInputSchema = z.object({
  topic: z.string().trim().min(3).max(300),
  primary_keyword: z.string().trim().min(1).max(120).optional(),
  secondary_keywords: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  decision: z.enum(["new", "rewrite", "optimize"]).default("new"),
  notes: z.string().trim().max(4000).optional(),
});
export const promoInputSchema = z.object({ article_id: uuid, scheduled_after: z.string().datetime({ offset: true }).optional(), plan: planMetaSchema.optional() });
export const rewriteInputSchema = z.object({ post_id: uuid });
export const seoClusterInputSchema = z.object({ limit: z.number().int().min(1).max(300).default(300) });
export const pinInputSchema = z
  .object({ media_asset_id: uuid.optional(), project_id: uuid.optional(), board_id: z.string().optional(), notes: z.string().trim().max(2000).optional() })
  .refine((v) => Boolean(v.media_asset_id) !== Boolean(v.project_id), { message: "Give exactly one of media_asset_id or project_id" });

export const captionsSchema = z.object({ facebook: z.string().min(1), instagram: z.string().min(1) });
export const captionResultSchema = z.object({ captions: captionsSchema, category_slug: z.string().optional() });
export const articleResultSchema = z.object({ article_id: uuid });
export const postResultSchema = z.object({ post_id: uuid });
export const seoClusterResultSchema = z.object({ assigned: z.number().int() });
export const pinResultSchema = z.object({ pin_id: uuid });

export const JOB_INPUT = { caption: captionInputSchema, article: articleInputSchema, promo: promoInputSchema, rewrite: rewriteInputSchema, seo_cluster: seoClusterInputSchema, pin: pinInputSchema } as const;
export const JOB_RESULT = { caption: captionResultSchema, article: articleResultSchema, promo: postResultSchema, rewrite: postResultSchema, seo_cluster: seoClusterResultSchema, pin: pinResultSchema } as const;

export type CaptionInput = z.infer<typeof captionInputSchema>;
export type ArticleInput = z.infer<typeof articleInputSchema>;
export type PromoInput = z.infer<typeof promoInputSchema>;
export type RewriteInput = z.infer<typeof rewriteInputSchema>;
export type SeoClusterInput = z.infer<typeof seoClusterInputSchema>;
export type PinInput = z.infer<typeof pinInputSchema>;
export type JobInput = { caption: CaptionInput; article: ArticleInput; promo: PromoInput; rewrite: RewriteInput; seo_cluster: SeoClusterInput; pin: PinInput };
export type CaptionResult = z.infer<typeof captionResultSchema>;

export function parseJobInput(type: JobType, raw: unknown) {
  return JOB_INPUT[type].safeParse(raw);
}
export function parseJobResult(type: JobType, raw: unknown) {
  return JOB_RESULT[type].safeParse(raw);
}
/** The tool whose successful call ends a job of this type. */
export const TERMINAL_TOOL: Record<JobType, string> = { caption: "submit_captions", article: "create_article", promo: "create_post", rewrite: "create_post", seo_cluster: "assign_clusters", pin: "create_pin" };
