export type PlanPlatform = "facebook" | "instagram";
export type Lane = "new_page" | "recycle" | "promo" | "filler";

/** One recurring slot in the brand's cadence. dow: 0 = Sunday … 6 = Saturday. time: "HH:mm" brand-local. */
export type ScheduleSlot = { dow: number; platform: PlanPlatform; time: string };

export type BrandSchedule = {
  brand_id: string;
  slots: ScheduleSlot[];
  recycle_cap: number;
  rest_days_min: number;
  rest_days_max: number;
  history_synced_at: string | null;
};

export type HistoryMedia = { url: string; kind: "image" | "video" | "carousel" };
export type HistoryRow = {
  id: string;
  brand_id: string;
  platform: PlanPlatform;
  external_id: string;
  published_at: string;
  caption: string;
  media: HistoryMedia[];
  permalink: string | null;
  likes: number;
  comments: number;
  shares: number;
  reach: number | null;
  interactions: number;
  post_id: string | null;
};

/** A concrete slot for one week: date is brand-local YYYY-MM-DD, at is ISO UTC. */
export type ResolvedSlot = { date: string; dow: number; platform: PlanPlatform; at: string; low_sample: boolean };

export type ProjectLike = { id: string; title: string; url: string | null; category: string | null; state: string | null; images: { url: string; alt?: string }[]; imported_at: string };
export type ArticleLike = { id: string; title: string; published_at: string | null };

export type Candidate = {
  id: string; // stable across rebuilds: `project:<id>` | `history:<id>` | `article:<id>`
  lane: Lane;
  reason: string;
  title: string;
  media: { url: string; alt?: string }[];
  project?: ProjectLike;
  history?: HistoryRow;
  article?: ArticleLike;
};

export type Pick = { date: string; slots: ResolvedSlot[]; candidate: Candidate };

export type PlanMeta = { week_start: string; lane: Lane; reason: string; candidate_id: string; touched: boolean };
