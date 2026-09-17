import type { LinkEdge, NoneReason, NoneVerdict, PageLite, Suggestion } from "./types";

export const SITE_WIDE_SHARE = 0.4;
export const SITE_WIDE_MIN_POSTS = 5;
export const FUNCTION_WORDS = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "vs", "your", "our", "is", "are", "what", "how", "why", "when", "where", "which"]);
export const FILLER_WORDS = new Set(["compared", "explained", "guide", "options"]);
export const STOP_WORDS = new Set([...FUNCTION_WORDS, ...FILLER_WORDS]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function phraseRegex(phrase: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(phrase).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");
}

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean);

export function candidatePhrases(page: PageLite): string[] {
  const out: string[] = [];
  const push = (s: string, allowSingle = false) => {
    const t = s.toLowerCase().replace(/\s+/g, " ").trim();
    const n = t.split(" ").length;
    if (!t || (n < 2 && !allowSingle) || out.includes(t)) return;
    if (words(t).every((w) => STOP_WORDS.has(w))) return;
    out.push(t);
  };
  if (page.focus_keyword) push(page.focus_keyword, true);
  push(page.title);
  push(page.title.split(/\s*[:–—-]\s+/)[0]);
  const w = words(page.title).filter((x) => !FUNCTION_WORDS.has(x));
  for (const n of [4, 3, 2]) for (let i = 0; i + n <= w.length; i++) push(w.slice(i, i + n).join(" "));
  return out;
}

export function siteWideTerms(phrases: string[], posts: PageLite[]): Set<string> {
  const out = new Set<string>();
  if (posts.length < SITE_WIDE_MIN_POSTS) return out;
  for (const p of phrases) {
    const re = phraseRegex(p);
    const n = posts.filter((x) => re.test(x.content_text)).length;
    if (n / posts.length > SITE_WIDE_SHARE) out.add(p);
  }
  return out;
}

const SENTENCE_BOUNDARY = /[.!?]\s/g;

function boundaryStart(text: string, index: number): number {
  SENTENCE_BOUNDARY.lastIndex = 0;
  let last = 0;
  let bm: RegExpExecArray | null;
  while ((bm = SENTENCE_BOUNDARY.exec(text))) {
    if (bm.index >= index) break;
    last = bm.index + bm[0].length;
  }
  return last;
}

function boundaryEnd(text: string, index: number): number {
  SENTENCE_BOUNDARY.lastIndex = index;
  const bm = SENTENCE_BOUNDARY.exec(text);
  return bm ? bm.index + 1 : text.length;
}

export function contextFor(text: string, phrase: string): string {
  const re = phraseRegex(phrase);
  const m = re.exec(text);
  if (!m) return "";
  const start = boundaryStart(text, m.index);
  const end = boundaryEnd(text, m.index + m[0].length);
  const s = text.slice(start, end).trim();
  return s.length > 260 ? s.slice(Math.max(0, m.index - start - 120), m.index - start + m[0].length + 120).trim() : s;
}

const overlap = (a: string, b: string) => {
  const A = new Set(words(a).filter((w) => !STOP_WORDS.has(w)));
  return words(b).filter((w) => A.has(w)).length;
};

/** One suggestion for an orphan, or a verdict explaining why none. `rejected` holds `${hostId}|${phrase}` keys. */
export function suggestFor(orphan: PageLite, posts: PageLite[], edges: LinkEdge[], rejected: Set<string>): Suggestion | NoneVerdict {
  const hostsAll = posts.filter((p) => p.type === "post" && p.id !== orphan.id);
  const linkers = new Set(edges.filter((e) => e.to_page_id === orphan.id).map((e) => e.from_page_id));
  const hosts = hostsAll.filter((p) => !linkers.has(p.id));
  const phrases = candidatePhrases(orphan);
  const allPosts = posts.filter((p) => p.type === "post");
  const wide = siteWideTerms(phrases, allPosts);
  let sawWide = false;
  let sawOnlySelf = false;
  for (const phrase of [...phrases].sort((a, b) => b.length - a.length)) {
    if (wide.has(phrase)) {
      sawWide = true;
      continue;
    }
    const re = phraseRegex(phrase);
    const matches = hosts.filter((h) => re.test(h.content_text) && !rejected.has(`${h.id}|${phrase}`));
    if (matches.length === 0) {
      if (re.test(orphan.content_text) || [...linkers].some((id) => re.test(posts.find((p) => p.id === id)?.content_text ?? ""))) sawOnlySelf = true;
      continue;
    }
    matches.sort((a, b) => overlap(orphan.title, b.title) - overlap(orphan.title, a.title) || (b.modified_at ?? "").localeCompare(a.modified_at ?? ""));
    const host = matches[0];
    return { orphan_page_id: orphan.id, host_page_id: host.id, phrase, context: contextFor(host.content_text, phrase) };
  }
  const reason: NoneReason = sawWide ? "site-wide term" : sawOnlySelf ? "only inside itself or in posts that already link here" : "no other post mentions the topic";
  return { orphan_page_id: orphan.id, reason, phrases_tried: phrases };
}
