import { normaliseKeyword, tokens } from "./score";

export type ArticleRef = { id: string; title: string; slug: string; status: string; primary_keyword: string | null; secondary_keywords: string[]; wp_link: string | null };
export type SitePageRef = { slug: string; url: string; title: string; type: string; focus_keyword: string | null };
export type GscPageRef = { page: string; position: number; clicks: number };

export type CannibalizationInput = { keyword: string; slug?: string; articles: ArticleRef[]; sitePages: SitePageRef[]; gscPages?: GscPageRef[]; opportunityKeywords?: string[]; siteMirroredAt?: string | null; pagesMirrored?: number };

export type CannibalizationResult = {
  keyword: string;
  slug: string | null;
  has_conflict: boolean;
  verdict: string;
  conflicts: {
    articles_with_same_primary_keyword: Pick<ArticleRef, "id" | "title" | "slug" | "status">[];
    articles_with_same_slug: Pick<ArticleRef, "id" | "title" | "slug" | "status">[];
    live_page_on_this_topic: SitePageRef | null;
    live_page_using_this_slug: SitePageRef | null;
    page_already_ranking: GscPageRef | null;
  };
  live_site_check: { pages_mirrored: number; last_scanned: string | null; note: string; live_titles_mentioning_it: SitePageRef[] };
  articles_targeting_it_as_secondary: Pick<ArticleRef, "id" | "title" | "slug">[];
  already_listed_as_opportunity: boolean;
};

const containsAll = (hay: string, needles: string[]) => {
  const h = tokens(hay);
  return needles.length > 0 && needles.every((n) => h.includes(n));
};

export function checkCannibalization(i: CannibalizationInput): CannibalizationResult {
  const kw = normaliseKeyword(i.keyword);
  const slug = i.slug ? normaliseKeyword(i.slug).replace(/\s+/g, "-") : null;
  const kwTokens = tokens(kw);
  const pick = (a: ArticleRef) => ({ id: a.id, title: a.title, slug: a.slug, status: a.status });

  const samePrimary = i.articles.filter((a) => a.primary_keyword && normaliseKeyword(a.primary_keyword) === kw).map(pick);
  const sameSlug = slug ? i.articles.filter((a) => a.slug === slug).map(pick) : [];
  const liveSlug = slug ? i.sitePages.find((p) => p.slug === slug) ?? null : null;
  const liveTopic = i.sitePages.find((p) => (p.focus_keyword && normaliseKeyword(p.focus_keyword) === kw) || containsAll(p.title, kwTokens)) ?? null;
  const mentioning = i.sitePages.filter((p) => p !== liveTopic && kwTokens.length > 0 && kwTokens.filter((t) => tokens(p.title).includes(t)).length >= Math.min(2, kwTokens.length)).slice(0, 5);
  const ranking = (i.gscPages ?? []).slice().sort((a, b) => a.position - b.position)[0] ?? null;
  const secondary = i.articles.filter((a) => a.secondary_keywords.some((s) => normaliseKeyword(s) === kw)).map((a) => ({ id: a.id, title: a.title, slug: a.slug }));

  const has_conflict = samePrimary.length > 0 || sameSlug.length > 0 || Boolean(liveSlug) || Boolean(liveTopic) || Boolean(ranking);
  let verdict: string;
  if (liveSlug) verdict = `CONFLICT — the slug "${slug}" is already live at ${liveSlug.url}. Pick a different slug; WordPress would rename yours to "${slug}-2".`;
  else if (sameSlug.length) verdict = `CONFLICT — an article in JamSam Social already uses the slug "${slug}" (${sameSlug[0].title}, ${sameSlug[0].status}).`;
  else if (samePrimary.length) verdict = `CONFLICT — "${samePrimary[0].title}" already targets "${kw}" as its primary keyword (${samePrimary[0].status}). Optimize or rewrite that article instead of creating a new one.`;
  else if (liveTopic) verdict = `CONFLICT — the live page "${liveTopic.title}" (${liveTopic.url}) already covers "${kw}". Prefer OPTIMIZE on that page.`;
  else if (ranking) verdict = `CONFLICT — ${ranking.page} already ranks #${Math.round(ranking.position)} for "${kw}" in Search Console. Optimize that page rather than splitting the ranking.`;
  else verdict = `CLEAR — nothing in JamSam Social or on the live site targets "${kw}"${slug ? ` and the slug "${slug}" is free` : ""}.`;

  const note = i.pagesMirrored ? `Checked against ${i.pagesMirrored} published pages/posts mirrored from the live site.` : "The live site has not been mirrored yet, so the live half of this check did not run. Mirror the site under SEO → Imports.";
  return {
    keyword: kw, slug, has_conflict, verdict,
    conflicts: { articles_with_same_primary_keyword: samePrimary, articles_with_same_slug: sameSlug, live_page_on_this_topic: liveTopic, live_page_using_this_slug: liveSlug, page_already_ranking: ranking },
    live_site_check: { pages_mirrored: i.pagesMirrored ?? 0, last_scanned: i.siteMirroredAt ?? null, note, live_titles_mentioning_it: mentioning },
    articles_targeting_it_as_secondary: secondary,
    already_listed_as_opportunity: (i.opportunityKeywords ?? []).some((k) => normaliseKeyword(k) === kw),
  };
}
