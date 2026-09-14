import { normaliseKeyword } from "./score";

/** Minimal RFC-4180 parser: quotes, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ALIASES: Record<string, string[]> = {
  keyword: ["keyword", "keywords", "query", "search term", "term"],
  volume: ["search volume", "volume", "monthly volume", "avg monthly searches", "searches"],
  difficulty: ["keyword difficulty", "kd", "difficulty", "kd %", "keyword difficulty index"],
  intent: ["intent", "search intent"],
  competitor: ["competitor", "domain", "best competitor", "competitor domain"],
  competitor_position: ["competitor position", "position", "best position", "competitor rank"],
  cluster: ["cluster", "topic", "group", "category", "keyword group"],
  our_position: ["our position", "your position", "current position"],
};

export type KeywordInput = { keyword: string; cluster?: string; volume?: number; difficulty?: number; intent?: string; competitor?: string; competitor_position?: number; our_position?: number };
export type ParsedKeywords = { rows: KeywordInput[]; skipped: number; columns: string[]; layout: "generic" | "keyword_gap" };

const num = (v: string | undefined) => {
  if (v === undefined) return undefined;
  const n = Number(String(v).replace(/[,%$\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Generic keyword CSVs (any of the alias headers) and SEMrush Keyword Gap exports, where each domain has its own
 * position column ("example.com", "example.com (Position)"…); the best-positioned non-brand domain becomes the competitor.
 */
export function parseKeywordCsv(text: string, opts: { brandDomain?: string } = {}): ParsedKeywords {
  const rows = parseCsv(text);
  if (rows.length < 2) return { rows: [], skipped: 0, columns: rows[0] ?? [], layout: "generic" };
  const headers = rows[0].map(norm);
  const col = (field: keyof typeof ALIASES) => headers.findIndex((h) => ALIASES[field].includes(h));
  const kwIdx = col("keyword");
  if (kwIdx < 0) throw new Error(`No keyword column found. Headers: ${rows[0].join(", ")}`);
  const domainCols = rows[0]
    .map((h, i) => ({ h: h.trim(), i }))
    .filter(({ h }) => /^[a-z0-9.-]+\.[a-z]{2,}(\s*\(position\))?$/i.test(h) && !/volume|difficulty|intent/i.test(h));
  const layout: ParsedKeywords["layout"] = domainCols.length >= 2 ? "keyword_gap" : "generic";
  const brand = opts.brandDomain?.toLowerCase().replace(/^www\./, "");
  const out: KeywordInput[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const keyword = normaliseKeyword(r[kwIdx] ?? "");
    if (!keyword) { skipped++; continue; }
    const k: KeywordInput = { keyword };
    const get = (f: keyof typeof ALIASES) => { const i = col(f); return i >= 0 ? r[i]?.trim() : undefined; };
    if (get("cluster")) k.cluster = get("cluster");
    if (get("volume") !== undefined) k.volume = num(get("volume"));
    if (get("difficulty") !== undefined) k.difficulty = num(get("difficulty"));
    if (get("intent")) k.intent = get("intent");
    if (layout === "keyword_gap") {
      let best: { d: string; p: number } | null = null;
      for (const { h, i } of domainCols) {
        const d = h.replace(/\s*\(position\)/i, "").toLowerCase().replace(/^www\./, "");
        const p = num(r[i]);
        if (d === brand) { if (p) k.our_position = p; continue; }
        if (p && p > 0 && (!best || p < best.p)) best = { d, p };
      }
      if (best) { k.competitor = best.d; k.competitor_position = best.p; }
    } else {
      if (get("competitor")) k.competitor = get("competitor")!.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      if (get("competitor_position") !== undefined) k.competitor_position = num(get("competitor_position"));
      if (get("our_position") !== undefined) k.our_position = num(get("our_position"));
    }
    out.push(k);
  }
  // Last occurrence of a duplicate keyword wins.
  const dedup = new Map(out.map((k) => [k.keyword, k]));
  return { rows: [...dedup.values()], skipped: skipped + (out.length - dedup.size), columns: rows[0], layout };
}

export type ProjectInput = { external_id?: string; title: string; url?: string; category?: string; location?: string; state?: string; dims?: string; description?: string; images: { url: string; alt?: string }[]; tags: string[] };
const P_ALIASES: Record<string, string[]> = {
  title: ["title", "name", "project", "project name"],
  url: ["url", "link", "page", "page url"],
  external_id: ["id", "job", "job number", "external id"],
  category: ["category", "type", "building type"],
  location: ["location", "city", "city state", "town"],
  state: ["state", "st"],
  dims: ["dims", "dimensions", "size"],
  description: ["description", "summary", "notes"],
  images: ["images", "image", "image urls", "photos", "photo"],
  tags: ["tags", "keywords"],
};

export function parseProjectsCsv(text: string): { rows: ProjectInput[]; skipped: number } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { rows: [], skipped: 0 };
  const headers = rows[0].map(norm);
  const col = (f: keyof typeof P_ALIASES) => headers.findIndex((h) => P_ALIASES[f].includes(h));
  if (col("title") < 0) throw new Error(`No title column found. Headers: ${rows[0].join(", ")}`);
  const out: ProjectInput[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const get = (f: keyof typeof P_ALIASES) => { const i = col(f); return i >= 0 ? r[i]?.trim() || undefined : undefined; };
    const title = get("title");
    if (!title) { skipped++; continue; }
    const images = (get("images") ?? "").split(/[|;\n]/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u)).map((url) => ({ url }));
    const tags = (get("tags") ?? "").split(/[|;,]/).map((t) => t.trim()).filter(Boolean);
    out.push({ title, external_id: get("external_id"), url: get("url"), category: get("category"), location: get("location"), state: get("state")?.toUpperCase().slice(0, 2), dims: get("dims"), description: get("description"), images, tags });
  }
  return { rows: out, skipped };
}
