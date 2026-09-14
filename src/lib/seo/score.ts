export type KeywordLike = {
  keyword: string;
  cluster?: string | null;
  volume?: number | null;
  difficulty?: number | null;
  intent?: string | null;
  competitor?: string | null;
  competitor_position?: number | null;
  our_position?: number | null;
  our_impressions?: number | null;
  our_clicks?: number | null;
  our_page?: string | null;
};

export function normaliseKeyword(k: string): string {
  return k.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Tokens for fuzzy title/keyword matching (drops 1–2 letter words). */
export function tokens(s: string): string[] {
  return normaliseKeyword(s).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((t) => t.length > 2);
}

const INTENT_WEIGHT: Record<string, number> = { transactional: 2, commercial: 1.5, informational: 1, navigational: 0.5 };

export function intentWeight(intent?: string | null): number {
  if (!intent) return 0.5;
  const parts = intent.toLowerCase().split(/[,/]/).map((p) => p.trim());
  return Math.max(0.5, ...parts.map((p) => INTENT_WEIGHT[p] ?? 0.5));
}

export function opportunityAction(k: KeywordLike, targetedByUs = false): string {
  if (k.our_page || targetedByUs) {
    return k.our_position ? `OPTIMIZE (ranks #${Math.round(k.our_position)})` : "OPTIMIZE (page exists, not ranking)";
  }
  return "NEW";
}

/** 0–10. Volume (log), ease, intent, striking distance, and a beatable competitor. */
export function opportunityScore(k: KeywordLike): number {
  const volume = Math.max(0, k.volume ?? 0);
  const difficulty = k.difficulty ?? 50;
  let s = 1.5 * Math.log10(volume + 10) + (100 - difficulty) / 33 + intentWeight(k.intent);
  if (k.our_position && k.our_position >= 5 && k.our_position <= 20) s += 1.5;
  if (k.competitor_position && k.competitor_position <= 10) s += 0.5;
  return Math.max(0, Math.min(10, Math.round(s * 100) / 100));
}

export type Opportunity<K extends KeywordLike = KeywordLike> = K & { action: string; score: number };
export type OpportunityFilters = { cluster?: string; action?: "NEW" | "OPTIMIZE"; q?: string; minVolume?: number; maxDifficulty?: number };

export function rankOpportunities<K extends KeywordLike>(keywords: K[], targeted: Set<string>, f: OpportunityFilters = {}): Opportunity<K>[] {
  return keywords
    .map((k) => ({ ...k, action: opportunityAction(k, targeted.has(normaliseKeyword(k.keyword))), score: opportunityScore(k) }))
    .filter((k) => !f.cluster || k.cluster === f.cluster)
    .filter((k) => !f.action || k.action.startsWith(f.action))
    .filter((k) => !f.q || k.keyword.includes(normaliseKeyword(f.q)))
    .filter((k) => f.minVolume === undefined || (k.volume ?? 0) >= f.minVolume)
    .filter((k) => f.maxDifficulty === undefined || (k.difficulty ?? 0) <= f.maxDifficulty)
    .sort((a, b) => b.score - a.score || (b.volume ?? 0) - (a.volume ?? 0) || a.keyword.localeCompare(b.keyword));
}
