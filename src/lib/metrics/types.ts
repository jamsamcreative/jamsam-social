import type { Database } from "@/lib/database.types";

export type MetricSource = Database["public"]["Enums"]["metric_source"];
export type MetricRow = { source: MetricSource; date: string; dim: string; metrics: Record<string, number>; extra?: Record<string, string> };
export const TOTAL_DIM = "_";
