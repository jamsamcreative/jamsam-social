import { fetchWithTimeout } from "@/lib/connections/http";
import { normaliseKeyword } from "@/lib/seo/score";
import type { KeywordInput } from "@/lib/seo/csv";

const BASE = "https://api.semrush.com/";
export const UNITS = { phraseThesePerKeyword: 10, domainDomainsPerRow: 10 };

export function estimateUnits(opts: { keywords: number; gapRows: number }): number {
  return opts.keywords * UNITS.phraseThesePerKeyword + opts.gapRows * UNITS.domainDomainsPerRow;
}

function parseSemrush(text: string): Record<string, string>[] {
  const t = text.trim();
  if (t.startsWith("ERROR")) throw new Error(`SEMrush: ${t}`);
  const lines = t.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(";");
  return lines.slice(1).map((l) => Object.fromEntries(l.split(";").map((v, i) => [headers[i], v])));
}

const INTENT_CODES: Record<string, string> = { "0": "Commercial", "1": "Informational", "2": "Navigational", "3": "Transactional" };
const intent = (v?: string) => (v ? v.split(",").map((c) => INTENT_CODES[c.trim()] ?? c).join(", ") : undefined);

/** Keyword overview for up to 100 keywords per call: volume, KD, intent. */
export async function phraseThese(apiKey: string, database: string, keywords: string[], fetchImpl: typeof fetch = fetch): Promise<KeywordInput[]> {
  const out: KeywordInput[] = [];
  for (let i = 0; i < keywords.length; i += 100) {
    const u = new URL(BASE);
    u.searchParams.set("type", "phrase_these");
    u.searchParams.set("key", apiKey);
    u.searchParams.set("database", database);
    u.searchParams.set("export_columns", "Ph,Nq,Kd,In");
    u.searchParams.set("phrase", keywords.slice(i, i + 100).join(";"));
    const res = await fetchWithTimeout(u, {}, 30_000, fetchImpl);
    for (const r of parseSemrush(await res.text())) out.push({ keyword: normaliseKeyword(r.Keyword ?? r.Ph ?? ""), volume: Number(r["Search Volume"] ?? r.Nq) || undefined, difficulty: Number(r["Keyword Difficulty Index"] ?? r.Kd) || undefined, intent: intent(r.Intent ?? r.In) });
  }
  return out.filter((k) => k.keyword);
}

/** Keyword gap: keywords competitors rank for (top 20) that the brand does not rank for (or ranks worse than 20). */
export async function domainDomains(apiKey: string, database: string, brandDomain: string, competitors: string[], limit: number, fetchImpl: typeof fetch = fetch): Promise<KeywordInput[]> {
  const comps = competitors.slice(0, 5);
  const domains = [brandDomain, ...comps].map((d, i) => `${i === 0 ? "-" : "*"}|or|${d}`).join("|");
  const u = new URL(BASE);
  u.searchParams.set("type", "domain_domains");
  u.searchParams.set("key", apiKey);
  u.searchParams.set("database", database);
  u.searchParams.set("domains", domains);
  u.searchParams.set("display_limit", String(limit));
  u.searchParams.set("export_columns", "Ph,Nq,Kd,In," + [brandDomain, ...comps].map((_, i) => `P${i}`).join(","));
  const res = await fetchWithTimeout(u, {}, 60_000, fetchImpl);
  return parseSemrush(await res.text()).map((r) => {
    const ours = Number(r[brandDomain] ?? r.P0) || undefined;
    const ranked = comps.map((d, i) => ({ d, p: Number(r[d] ?? r[`P${i + 1}`]) })).filter((x) => x.p > 0).sort((a, b) => a.p - b.p);
    const best = ranked[0];
    return { keyword: normaliseKeyword(r.Keyword ?? r.Ph ?? ""), volume: Number(r["Search Volume"] ?? r.Nq) || undefined, difficulty: Number(r["Keyword Difficulty Index"] ?? r.Kd) || undefined, intent: intent(r.Intent ?? r.In), competitor: best?.d, competitor_position: best?.p, our_position: ours };
  }).filter((k) => k.keyword);
}
