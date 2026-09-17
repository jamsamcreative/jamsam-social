# Phase 8: Internal Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find pages on a brand's WordPress site that no other body content links to, propose one exact phrase in an existing blog post to wrap in a link to each orphan, and on approval write that link into the live post (with undo).

**Architecture:** Extend the site mirror to store body text; pure functions in `src/lib/links/` build the link graph (`site_links`), find orphans, pick a host post + phrase (`link_suggestions`), and rewrite raw post HTML (wrap/unwrap). A `LinksStore` interface (Supabase + in-memory fake) isolates persistence; server actions drive scan/approve/reject/undo; a `/blog/links` page renders review cards. No Claude in the loop.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before touching pages/actions), Supabase (Postgres), TypeScript, zod, vitest, Playwright, shadcn/ui primitives in `src/components/ui`, existing WordPress client `src/lib/wordpress/client.ts`.

**Spec:** `docs/superpowers/specs/2026-09-17-jamsam-social-phase8-internal-links-design.md`

## Global Constraints

- **Never rewrite or invent text.** Approving only wraps words that already exist in the host post in `<a href="{orphan url}">…</a>`; undo only removes that exact wrapper.
- Orphan rule: no *other* page's or post's **body** content links to it. Nav/menus/index pages are not considered. **Hosts are published `type = 'post'` pages only.**
- Migration file is `supabase/migrations/0012_internal_links.sql`; `src/lib/database.types.ts` is hand-written and updated in the same task. New tables get RLS + the `"authenticated read"` select policy; writes go through the service role (`createAdminSupabase()`).
- Site-wide term threshold: phrase appears in **> 40 %** of posts with **≥ 5** posts. Candidate phrases need ≥ 2 words unless the focus keyword is a single word.
- Statuses: `pending | approved | rejected | undone | stale | none`. A rejected `(orphan, host, phrase)` is never re-proposed. One `pending` per orphan (partial unique index).
- Scan logs a `keyword_imports` row with `kind = 'link_scan'`.
- Run tests with `npx vitest run <path>`; typecheck `npx tsc --noEmit -p .`; lint `npx eslint <files>`. Commit after every green step; commit messages end with the attribution lines in the session reminder.
- Branch: `phase-8-internal-links` (already created off `main`, spec committed).

---

## File structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/0012_internal_links.sql` | `site_pages` content columns, `site_links`, `link_suggestions` |
| `src/lib/database.types.ts` | row types |
| `src/lib/links/types.ts` | shared types (`PageLite`, `LinkEdge`, `Suggestion`, `NoneVerdict`) |
| `src/lib/links/html.ts` | `htmlToText`, `extractInternalLinks`, `normaliseUrl` |
| `src/lib/links/graph.ts` | `resolveLinks`, `findOrphans` |
| `src/lib/links/suggest.ts` | `candidatePhrases`, `siteWideTerms`, `findHosts`, `suggestFor` |
| `src/lib/links/apply.ts` | `wrapPhrase`, `unwrapSnippet` |
| `src/lib/seo/mirror.ts` | mirror now returns `content_html` |
| `src/lib/links/store.ts` + `fake-store.ts` | `LinksStore` |
| `src/lib/links/scan.ts` | `scanBrand` orchestration |
| `src/lib/links/apply-actions.ts` | `approveSuggestion`, `undoSuggestion` (store + WP client) |
| `src/lib/links/actions.ts` | server actions |
| `src/lib/links/queries.ts` | page data |
| `src/app/(app)/blog/links/page.tsx`, `src/components/links/*` | UI |
| `e2e/links.spec.ts`, `e2e/global-teardown.ts` | e2e |

---

### Task 1: Migration + types

**Files:**
- Create: `supabase/migrations/0012_internal_links.sql`
- Modify: `src/lib/database.types.ts` (`SitePageRow`, new rows, `Tables` map)
- Create: `src/lib/links/types.ts`

**Interfaces:**
- Produces: tables/columns from the spec; TS types `SiteLinkRow`, `LinkSuggestionRow`, `LinkSuggestionStatus`; planner types below.

- [ ] **Step 1: Migration** — copy the spec's SQL verbatim into `supabase/migrations/0012_internal_links.sql` (the `alter table site_pages …` lines, `site_links`, the `link_suggestion_status` enum, `link_suggestions` with its trigger and indexes, RLS + policies).

- [ ] **Step 2: `database.types.ts`** — add to `SitePageRow`: `content_text: string | null; content_hash: string | null; word_count: number | null;`. Add:

```ts
type SiteLinkRow = { id: string; brand_id: string; from_page_id: string; to_page_id: string; href: string; anchor_text: string; scanned_at: string };
type LinkSuggestionRow = {
  id: string; brand_id: string; orphan_page_id: string; host_page_id: string | null; phrase: string | null; context: string | null;
  status: "pending" | "approved" | "rejected" | "undone" | "stale" | "none"; reason: string | null; phrases_tried: string[];
  href: string | null; undo_snippet: string | null; applied_at: string | null; applied_by: string | null; created_at: string; updated_at: string;
};
```

and in `Tables:` — `site_links: Table<SiteLinkRow, "brand_id" | "from_page_id" | "to_page_id" | "href">;` and `link_suggestions: Table<LinkSuggestionRow, "brand_id" | "orphan_page_id">;`. Add `link_suggestion_status` to the `Enums` block if one exists (mirror how `post_status` is declared).

- [ ] **Step 3: Types**

```ts
// src/lib/links/types.ts
export type PageLite = { id: string; wp_id: number; type: "post" | "page"; slug: string; url: string; title: string; focus_keyword: string | null; content_text: string; modified_at: string | null };
export type LinkEdge = { from_page_id: string; to_page_id: string; href: string; anchor_text: string };
export type Suggestion = { orphan_page_id: string; host_page_id: string; phrase: string; context: string };
export type NoneReason = "site-wide term" | "only inside itself or in posts that already link here" | "no other post mentions the topic";
export type NoneVerdict = { orphan_page_id: string; reason: NoneReason; phrases_tried: string[] };
export type Orphan = { page: PageLite; utility: boolean };
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit -p .` clean; `npx vitest run` green. Apply the migration with the DB password (ask; never store): `npx supabase db push --db-url "postgresql://postgres.dpihndeejbirskdrjfeh:<pw>@aws-0-us-east-2.pooler.supabase.com:5432/postgres" --yes`.

- [ ] **Step 5: Commit** — `feat(links): migration 0012 — site content, link graph, suggestions`.

---

### Task 2: HTML helpers — `htmlToText`, `normaliseUrl`, `extractInternalLinks`

**Files:** Create `src/lib/links/html.ts`, `src/lib/links/html.test.ts`

**Interfaces:**
- Produces: `htmlToText(html: string): string`; `normaliseUrl(href: string, siteOrigin: string): string | null` (absolute `https://host/path` without fragment/query/trailing slash, or null for external/mailto/tel/media); `extractInternalLinks(html: string, siteOrigin: string): { href: string; anchorText: string }[]`; `sha1(text: string): string`; `MEDIA_EXT` regex.

- [ ] **Step 1: Tests**

```ts
// src/lib/links/html.test.ts
import { describe, it, expect } from "vitest";
import { htmlToText, normaliseUrl, extractInternalLinks, sha1 } from "./html";

const ORIGIN = "https://acme.com";

describe("htmlToText", () => {
  it("strips tags, Gutenberg comments, scripts and styles, decodes entities, collapses whitespace", () => {
    const html = `<!-- wp:paragraph --><p>Pole barns &amp; shops &#8211; built <strong>right</strong>.</p><!-- /wp:paragraph --><script>x()</script><style>p{}</style>\n<h2>Sizes</h2><ul><li>30x40</li><li>40x60</li></ul>`;
    expect(htmlToText(html)).toBe("Pole barns & shops - built right. Sizes 30x40 40x60");
  });
  it("keeps sentence boundaries between blocks", () => {
    expect(htmlToText("<p>One.</p><p>Two.</p>")).toBe("One. Two.");
  });
});

describe("normaliseUrl", () => {
  it("resolves absolute, root-relative and protocol-relative internal links", () => {
    expect(normaliseUrl("https://acme.com/horse-barns/", ORIGIN)).toBe("https://acme.com/horse-barns");
    expect(normaliseUrl("/horse-barns/?utm=1#sizes", ORIGIN)).toBe("https://acme.com/horse-barns");
    expect(normaliseUrl("//acme.com/kits", ORIGIN)).toBe("https://acme.com/kits");
    expect(normaliseUrl("http://www.acme.com/kits/", ORIGIN)).toBe("https://acme.com/kits");
  });
  it("rejects external, mailto, tel, fragment-only and media links", () => {
    for (const h of ["https://other.com/x", "mailto:a@b.c", "tel:123", "#top", "/wp-content/uploads/a.jpg", "/files/spec.pdf"]) expect(normaliseUrl(h, ORIGIN)).toBeNull();
  });
});

describe("extractInternalLinks", () => {
  it("returns internal anchors with their text, in order, skipping external ones", () => {
    const html = `<p>See <a href="/horse-barns/">horse barns</a> and <a href="https://other.com">this</a>, or <a class="x" href='https://acme.com/kits#a'><em>kits</em></a>.</p>`;
    expect(extractInternalLinks(html, ORIGIN)).toEqual([
      { href: "https://acme.com/horse-barns", anchorText: "horse barns" },
      { href: "https://acme.com/kits", anchorText: "kits" },
    ]);
  });
});

describe("sha1", () => {
  it("is stable", () => { expect(sha1("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d"); });
});
```

- [ ] **Step 2: RED** — `npx vitest run src/lib/links/html.test.ts` fails: module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/links/html.ts
import { createHash } from "node:crypto";

export const MEDIA_EXT = /\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|mov|mp3|docx?|xlsx?)$/i;

const ENTITIES: [RegExp, string][] = [
  [/&amp;/g, "&"], [/&lt;/g, "<"], [/&gt;/g, ">"], [/&quot;/g, '"'], [/&#0?39;|&apos;|&#8217;|&rsquo;|&#8216;|&lsquo;/g, "'"],
  [/&#8211;|&ndash;|&#8212;|&mdash;/g, "-"], [/&#8230;|&hellip;/g, "…"], [/&nbsp;|&#160;/g, " "], [/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"'],
];
export function decodeEntities(s: string): string {
  let out = s;
  for (const [re, rep] of ENTITIES) out = out.replace(re, rep);
  return out.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Body HTML → plain text. Block-level tags become spaces so sentences don't run together. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote|section|article|figure|figcaption|table|tr|td|th|br|hr)>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\s+/g, " ").trim();
}

export function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/** Canonical https://host/path for an internal link; null when it is not a page on this site. */
export function normaliseUrl(href: string, siteOrigin: string): string | null {
  const h = href.trim();
  if (!h || /^(mailto:|tel:|javascript:|#)/i.test(h)) return null;
  let u: URL;
  try {
    u = new URL(h.startsWith("//") ? `https:${h}` : h, siteOrigin);
  } catch { return null; }
  const origin = new URL(siteOrigin);
  const host = (x: string) => x.replace(/^www\./, "").toLowerCase();
  if (host(u.hostname) !== host(origin.hostname)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (MEDIA_EXT.test(path) || /^\/wp-content\//.test(path)) return null;
  return `https://${host(origin.hostname)}${path}`;
}

export function extractInternalLinks(html: string, siteOrigin: string): { href: string; anchorText: string }[] {
  const out: { href: string; anchorText: string }[] = [];
  const re = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = normaliseUrl(m[1] ?? m[2] ?? "", siteOrigin);
    if (href) out.push({ href, anchorText: htmlToText(m[3]) });
  }
  return out;
}
```

- [ ] **Step 4: GREEN** — `npx vitest run src/lib/links/html.test.ts` passes (6). Fix `htmlToText` expectations only if the entity/space handling in the test is genuinely wrong (the "&#8211;" → "-" mapping is intentional).

- [ ] **Step 5: Commit** — `feat(links): html text, url normalisation, internal link extraction`.

---

### Task 3: Graph — `resolveLinks`, `findOrphans`

**Files:** Create `src/lib/links/graph.ts`, `src/lib/links/graph.test.ts`

**Interfaces:**
- Consumes: `normaliseUrl`, `extractInternalLinks` (Task 2); `PageLite`, `LinkEdge`, `Orphan` (Task 1).
- Produces: `buildEdges(pages: (PageLite & { content_html: string })[], siteOrigin: string): LinkEdge[]`; `findOrphans(pages: PageLite[], edges: LinkEdge[]): Orphan[]`; `UTILITY_SLUGS`.

- [ ] **Step 1: Tests**

```ts
// src/lib/links/graph.test.ts
import { describe, it, expect } from "vitest";
import { buildEdges, findOrphans } from "./graph";
import type { PageLite } from "./types";

const ORIGIN = "https://acme.com";
const pg = (id: string, slug: string, o: Partial<PageLite & { content_html: string }> = {}): PageLite & { content_html: string } => ({ id, type: "post", slug, url: `https://acme.com/${slug}/`, title: slug, focus_keyword: null, content_text: "", modified_at: null, content_html: "", ...o });

describe("buildEdges", () => {
  it("resolves by normalised url, then by slug, and drops self links and unknown targets", () => {
    const pages = [
      pg("a", "horse-barns", { content_html: `<a href="/pole-barns/">pole</a> <a href="https://acme.com/horse-barns">me</a> <a href="/nope/">x</a> <a href="https://www.acme.com/kits?x=1#y">kits</a>` }),
      pg("b", "pole-barns"), pg("c", "kits", { url: "https://acme.com/blog/kits/" }),
    ];
    expect(buildEdges(pages, ORIGIN)).toEqual([
      { from_page_id: "a", to_page_id: "b", href: "https://acme.com/pole-barns", anchor_text: "pole" },
      { from_page_id: "a", to_page_id: "c", href: "https://acme.com/kits", anchor_text: "kits" },
    ]);
  });
});

describe("findOrphans", () => {
  it("returns pages with no inbound edge from a different page, utility pages last", () => {
    const pages = [pg("a", "horse-barns"), pg("b", "pole-barns"), pg("p", "privacy-policy", { type: "page" }), pg("h", "kits")];
    const edges = [{ from_page_id: "a", to_page_id: "b", href: "", anchor_text: "" }, { from_page_id: "h", to_page_id: "h", href: "", anchor_text: "" }];
    expect(findOrphans(pages, edges).map((o) => [o.page.id, o.utility])).toEqual([["a", false], ["h", false], ["p", true]]);
  });
});
```

- [ ] **Step 2: RED** — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/links/graph.ts
import { extractInternalLinks, normaliseUrl } from "./html";
import type { LinkEdge, Orphan, PageLite } from "./types";

export const UTILITY_SLUGS = new Set(["privacy-policy", "privacy", "terms", "terms-of-service", "thank-you", "sitemap", "front-page", "home"]);

export function buildEdges(pages: (PageLite & { content_html: string })[], siteOrigin: string): LinkEdge[] {
  const byUrl = new Map<string, string>();
  const bySlug = new Map<string, string>();
  for (const p of pages) {
    const u = normaliseUrl(p.url, siteOrigin);
    if (u) byUrl.set(u, p.id);
    bySlug.set(p.slug, p.id);
  }
  const edges: LinkEdge[] = [];
  for (const p of pages) {
    for (const l of extractInternalLinks(p.content_html, siteOrigin)) {
      const slug = l.href.split("/").filter(Boolean).pop() ?? "";
      const to = byUrl.get(l.href) ?? bySlug.get(slug);
      if (!to || to === p.id) continue;
      edges.push({ from_page_id: p.id, to_page_id: to, href: l.href, anchor_text: l.anchorText });
    }
  }
  return edges;
}

export function findOrphans(pages: PageLite[], edges: LinkEdge[]): Orphan[] {
  const inbound = new Set(edges.filter((e) => e.from_page_id !== e.to_page_id).map((e) => e.to_page_id));
  return pages
    .filter((p) => !inbound.has(p.id))
    .map((page) => ({ page, utility: page.type === "page" && UTILITY_SLUGS.has(page.slug) }))
    .sort((a, b) => Number(a.utility) - Number(b.utility) || a.page.title.localeCompare(b.page.title));
}
```

- [ ] **Step 4: GREEN**; **Step 5: Commit** — `feat(links): link graph edges and orphan detection`.

---

### Task 4: Suggestions — phrases, site-wide filter, host pick

**Files:** Create `src/lib/links/suggest.ts`, `src/lib/links/suggest.test.ts`

**Interfaces:**
- Consumes: `PageLite`, `Suggestion`, `NoneVerdict`, `LinkEdge`.
- Produces: `candidatePhrases(page: PageLite): string[]`; `phraseRegex(phrase: string): RegExp` (whole-word, case-insensitive, Unicode); `siteWideTerms(phrases: string[], posts: PageLite[]): Set<string>`; `contextFor(text: string, phrase: string): string`; `suggestFor(orphan: PageLite, posts: PageLite[], edges: LinkEdge[], rejected: Set<string> /* `${hostId}|${phrase}` */): Suggestion | NoneVerdict`; constants `SITE_WIDE_SHARE = 0.4`, `SITE_WIDE_MIN_POSTS = 5`, `STOP_WORDS`.

- [ ] **Step 1: Tests**

```ts
// src/lib/links/suggest.test.ts
import { describe, it, expect } from "vitest";
import { candidatePhrases, siteWideTerms, suggestFor, contextFor, phraseRegex } from "./suggest";
import type { PageLite } from "./types";

const pg = (id: string, title: string, o: Partial<PageLite> = {}): PageLite => ({ id, type: "post", slug: id, url: `https://acme.com/${id}/`, title, focus_keyword: null, content_text: "", modified_at: null, ...o });

describe("candidatePhrases", () => {
  it("orders focus keyword, title, title without subtitle, then n-grams; no stop-word-only phrases or duplicates", () => {
    const p = pg("x", "Metal Roof Vents: Ridge, Static, and Turbine Options Compared", { focus_keyword: "metal roof vents" });
    const out = candidatePhrases(p);
    expect(out[0]).toBe("metal roof vents");
    expect(out[1]).toBe("metal roof vents: ridge, static, and turbine options compared");
    expect(out).toContain("turbine options");
    expect(out).toContain("ridge static");
    expect(out).not.toContain("and turbine");
    expect(new Set(out).size).toBe(out.length);
    expect(out.every((s) => s.trim().split(/\s+/).length >= 2)).toBe(true);
  });
  it("allows a single-word focus keyword", () => {
    expect(candidatePhrases(pg("y", "Barndominiums", { focus_keyword: "barndominiums" }))[0]).toBe("barndominiums");
  });
});

describe("phraseRegex / contextFor", () => {
  it("matches whole words case-insensitively and returns the containing sentence", () => {
    expect(phraseRegex("pole barn").test("A Pole Barn is cheap.")).toBe(true);
    expect(phraseRegex("pole barn").test("Tadpole barnacle")).toBe(false);
    expect(contextFor("Intro here. Our pole barn kits ship fast. Later text.", "pole barn")).toBe("Our pole barn kits ship fast.");
  });
});

describe("siteWideTerms", () => {
  it("flags phrases present in more than 40% of posts when there are at least 5 posts", () => {
    const posts = Array.from({ length: 6 }, (_, i) => pg(`p${i}`, `t${i}`, { content_text: i < 4 ? "we build metal buildings here" : "other text" }));
    expect(siteWideTerms(["metal buildings", "other text"], posts)).toEqual(new Set(["metal buildings"]));
    expect(siteWideTerms(["metal buildings"], posts.slice(0, 4))).toEqual(new Set());
  });
});

describe("suggestFor", () => {
  const orphan = pg("o", "Pole Barn Kits: Prices and Sizes", { focus_keyword: "pole barn kits" });
  const posts = [
    orphan,
    pg("h1", "Shop Builds in Spokane", { content_text: "Most customers start with pole barn kits and add a lean-to.", modified_at: "2026-01-01T00:00:00Z" }),
    pg("h2", "Pole Barn Kits FAQ", { content_text: "Our pole barn kits ship in 3 weeks.", modified_at: "2025-01-01T00:00:00Z" }),
    pg("linker", "Already links", { content_text: "pole barn kits are great" }),
    pg("page1", "Service page", { type: "page", content_text: "pole barn kits pole barn kits" }),
  ];
  const edges = [{ from_page_id: "linker", to_page_id: "o", href: "", anchor_text: "" }];
  it("picks the longest matching phrase and the host with most title overlap, skipping the orphan, existing linkers and pages", () => {
    const s = suggestFor(orphan, posts, edges, new Set());
    expect(s).toEqual({ orphan_page_id: "o", host_page_id: "h2", phrase: "pole barn kits", context: "Our pole barn kits ship in 3 weeks." });
  });
  it("never re-proposes a rejected host+phrase", () => {
    const s = suggestFor(orphan, posts, edges, new Set(["h2|pole barn kits"]));
    expect(s).toMatchObject({ host_page_id: "h1" });
  });
  it("returns a none verdict with the right reason and phrases tried", () => {
    const lonely = pg("z", "Something Unique Entirely", { focus_keyword: "something unique" });
    expect(suggestFor(lonely, [lonely, ...posts.slice(1)], [], new Set())).toEqual({ orphan_page_id: "z", reason: "no other post mentions the topic", phrases_tried: expect.arrayContaining(["something unique"]) });
    const onlySelf = pg("s", "Self Only Topic", { content_text: "self only topic here" });
    expect(suggestFor(onlySelf, [onlySelf, pg("q", "Q", { content_text: "self only topic" })], [{ from_page_id: "q", to_page_id: "s", href: "", anchor_text: "" }], new Set())).toMatchObject({ reason: "only inside itself or in posts that already link here" });
    const wide = pg("w", "Metal Buildings Guide", { focus_keyword: "metal buildings" });
    const many = Array.from({ length: 6 }, (_, i) => pg(`m${i}`, `m${i}`, { content_text: "metal buildings everywhere" }));
    expect(suggestFor(wide, [wide, ...many], [], new Set())).toMatchObject({ reason: "site-wide term" });
  });
});
```

- [ ] **Step 2: RED** — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/links/suggest.ts
import type { LinkEdge, NoneReason, NoneVerdict, PageLite, Suggestion } from "./types";

export const SITE_WIDE_SHARE = 0.4;
export const SITE_WIDE_MIN_POSTS = 5;
export const STOP_WORDS = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "vs", "your", "our", "is", "are", "what", "how", "why", "when", "where", "which", "compared", "explained", "guide", "options"]);

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
  const w = words(page.title).filter((x) => !STOP_WORDS.has(x));
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

export function contextFor(text: string, phrase: string): string {
  const re = phraseRegex(phrase);
  const m = re.exec(text);
  if (!m) return "";
  const start = Math.max(text.lastIndexOf(". ", m.index) + 2, 0);
  const endIdx = text.indexOf(". ", m.index + m[0].length);
  const end = endIdx === -1 ? text.length : endIdx + 1;
  const s = text.slice(start, end).trim();
  return s.length > 260 ? s.slice(Math.max(0, m.index - start - 120), m.index - start + phrase.length + 120).trim() : s;
}

const overlap = (a: string, b: string) => { const A = new Set(words(a).filter((w) => !STOP_WORDS.has(w))); return words(b).filter((w) => A.has(w)).length; };

/** One suggestion for an orphan, or a verdict explaining why none. `rejected` holds `${hostId}|${phrase}` keys. */
export function suggestFor(orphan: PageLite, posts: PageLite[], edges: LinkEdge[], rejected: Set<string>): Suggestion | NoneVerdict {
  const hostsAll = posts.filter((p) => p.type === "post" && p.id !== orphan.id);
  const linkers = new Set(edges.filter((e) => e.to_page_id === orphan.id).map((e) => e.from_page_id));
  const hosts = hostsAll.filter((p) => !linkers.has(p.id));
  const phrases = candidatePhrases(orphan);
  const wide = siteWideTerms(phrases, hostsAll);
  let sawWide = false, sawOnlySelf = false;
  for (const phrase of [...phrases].sort((a, b) => b.length - a.length)) {
    if (wide.has(phrase)) { sawWide = true; continue; }
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
  const reason: NoneReason = sawWide && phrases.every((p) => wide.has(p)) ? "site-wide term" : sawOnlySelf ? "only inside itself or in posts that already link here" : "no other post mentions the topic";
  return { orphan_page_id: orphan.id, reason, phrases_tried: phrases };
}
```

- [ ] **Step 4: GREEN** — `npx vitest run src/lib/links/suggest.test.ts`. If `contextFor`'s sentence splitting disagrees with the test on the exact string, adjust the implementation (the test's expected sentence is the contract).

- [ ] **Step 5: Commit** — `feat(links): phrase candidates, site-wide filter, host selection`.

---

### Task 5: Apply — `wrapPhrase`, `unwrapSnippet`

**Files:** Create `src/lib/links/apply.ts`, `src/lib/links/apply.test.ts`

**Interfaces:**
- Consumes: `phraseRegex` (Task 4).
- Produces: `wrapPhrase(rawHtml: string, phrase: string, href: string): { html: string; snippet: string } | null`; `unwrapSnippet(rawHtml: string, snippet: string): string | null`.

- [ ] **Step 1: Tests**

```ts
// src/lib/links/apply.test.ts
import { describe, it, expect } from "vitest";
import { wrapPhrase, unwrapSnippet } from "./apply";

const HREF = "https://acme.com/pole-barn-kits/";

describe("wrapPhrase", () => {
  it("wraps the first whole-word occurrence outside anchors, headings, code and block comments, keeping original casing", () => {
    const html = `<!-- wp:heading --><h2>Pole Barn Kits</h2><!-- /wp:heading --><!-- wp:paragraph --><p>Already <a href="/x">pole barn kits</a> linked. Our Pole barn kits ship fast, and pole barn kits again.</p><!-- /wp:paragraph --><pre>pole barn kits</pre>`;
    const r = wrapPhrase(html, "pole barn kits", HREF)!;
    expect(r.snippet).toBe(`<a href="${HREF}">Pole barn kits</a>`);
    expect(r.html).toBe(`<!-- wp:heading --><h2>Pole Barn Kits</h2><!-- /wp:heading --><!-- wp:paragraph --><p>Already <a href="/x">pole barn kits</a> linked. Our <a href="${HREF}">Pole barn kits</a> ship fast, and pole barn kits again.</p><!-- /wp:paragraph --><pre>pole barn kits</pre>`);
  });
  it("returns null when the phrase is absent or only inside tags/anchors", () => {
    expect(wrapPhrase(`<p><a href="/x">pole barn kits</a></p>`, "pole barn kits", HREF)).toBeNull();
    expect(wrapPhrase(`<p data-x="pole barn kits">nothing</p>`, "pole barn kits", HREF)).toBeNull();
  });
  it("is idempotent when the snippet already exists", () => {
    const once = wrapPhrase(`<p>Our pole barn kits ship.</p>`, "pole barn kits", HREF)!;
    expect(wrapPhrase(once.html, "pole barn kits", HREF)).toEqual({ html: once.html, snippet: once.snippet });
  });
  it("matches across whitespace variants but keeps the original text", () => {
    const r = wrapPhrase(`<p>pole  barn\nkits here</p>`, "pole barn kits", HREF)!;
    expect(r.html).toBe(`<p><a href="${HREF}">pole  barn\nkits</a> here</p>`);
  });
});

describe("unwrapSnippet", () => {
  it("removes exactly that anchor and returns null if it is gone", () => {
    const html = `<p>Our <a href="${HREF}">Pole barn kits</a> ship.</p>`;
    expect(unwrapSnippet(html, `<a href="${HREF}">Pole barn kits</a>`)).toBe(`<p>Our Pole barn kits ship.</p>`);
    expect(unwrapSnippet(`<p>edited</p>`, `<a href="${HREF}">Pole barn kits</a>`)).toBeNull();
  });
});
```

- [ ] **Step 2: RED**; **Step 3: Implement**

```ts
// src/lib/links/apply.ts
import { phraseRegex } from "./suggest";

/** Split raw HTML into text segments that may be linked and protected segments (tags, comments, anchors, headings, code). */
function segments(html: string): { text: string; linkable: boolean }[] {
  const out: { text: string; linkable: boolean }[] = [];
  const re = /<!--[\s\S]*?-->|<a\b[\s\S]*?<\/a>|<(h[1-6]|pre|code|script|style)\b[\s\S]*?<\/\1>|<[^>]+>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index > last) out.push({ text: html.slice(last, m.index), linkable: true });
    out.push({ text: m[0], linkable: false });
    last = m.index + m[0].length;
  }
  if (last < html.length) out.push({ text: html.slice(last), linkable: true });
  return out;
}

export function wrapPhrase(rawHtml: string, phrase: string, href: string): { html: string; snippet: string } | null {
  const re = phraseRegex(phrase);
  const existing = new RegExp(`<a href="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">([^<]*)</a>`, "i").exec(rawHtml);
  if (existing && re.test(existing[1])) return { html: rawHtml, snippet: existing[0] };
  const segs = segments(rawHtml);
  for (const s of segs) {
    if (!s.linkable) continue;
    const m = re.exec(s.text);
    if (!m) continue;
    const snippet = `<a href="${href}">${m[0]}</a>`;
    s.text = s.text.slice(0, m.index) + snippet + s.text.slice(m.index + m[0].length);
    return { html: segs.map((x) => x.text).join(""), snippet };
  }
  return null;
}

export function unwrapSnippet(rawHtml: string, snippet: string): string | null {
  if (!rawHtml.includes(snippet)) return null;
  const inner = snippet.replace(/^<a [^>]*>/, "").replace(/<\/a>$/, "");
  return rawHtml.replace(snippet, inner);
}
```

- [ ] **Step 4: GREEN**; **Step 5: Commit** — `feat(links): wrap/unwrap phrase in raw post html`.

---

### Task 6: Mirror with content + `LinksStore` (Supabase + fake)

**Files:**
- Modify: `src/lib/seo/mirror.ts` (`MirroredPage` gains `content_html`, `_fields` adds `content`)
- Modify: `src/lib/seo/run.ts` `mirrorBrandSite` (store `content_text`, `content_hash`, `word_count`; strip `content_html` before upsert; return type becomes `{ pages: number; mirrored: MirroredPage[] } | { error: string }` so the scan can build edges from HTML — update `mirrorSiteNow` in `src/lib/seo/actions.ts` which only reads `pages`)
- Create: `src/lib/links/store.ts`, `src/lib/links/fake-store.ts`, `src/lib/links/fake-store.test.ts`
- Modify: any existing `mirror.test.ts` fixture to include `content`.

**Interfaces:**
- Produces:

```ts
export type PageWithHtml = PageLite & { content_html: string };
export interface LinksStore {
  getBrand(brandId: string): Promise<{ id: string; slug: string; name: string; website_url: string | null } | null>;
  listActiveBrands(): Promise<{ id: string; slug: string; name: string }[]>;
  listPages(brandId: string): Promise<PageLite[]>;                       // from site_pages (content_text '' when null)
  getPage(pageId: string): Promise<(PageLite & { wp_id: number }) | null>;
  replaceEdges(brandId: string, edges: LinkEdge[]): Promise<void>;
  addEdge(brandId: string, edge: LinkEdge): Promise<void>;
  removeEdge(brandId: string, fromId: string, toId: string, href: string): Promise<void>;
  listEdges(brandId: string): Promise<LinkEdge[]>;
  listSuggestions(brandId: string, statuses?: LinkSuggestionStatus[]): Promise<LinkSuggestionRow[]>;
  getSuggestion(id: string): Promise<LinkSuggestionRow | null>;
  rejectedKeys(brandId: string, orphanId: string): Promise<Set<string>>;      // `${host}|${phrase}` for status rejected
  upsertScanResults(brandId: string, results: (Suggestion | NoneVerdict)[], orphanIds: string[]): Promise<{ created: number; staled: number; removed: number }>;
  setStatus(id: string, patch: Partial<Pick<LinkSuggestionRow, "status" | "href" | "undo_snippet" | "applied_at" | "applied_by">>): Promise<void>;
  logScan(brandId: string, detail: string, rows: number, userId: string | null): Promise<void>;
  lastScan(brandId: string): Promise<string | null>;
  counts(brandId?: string): Promise<{ pages: number; pending: number; added: number }>;
}
export function createSupabaseLinksStore(): LinksStore;
```

`upsertScanResults` semantics: for every orphan id, delete existing rows with status in (`pending`,`none`) unless a `pending` row has the same host+phrase as the new suggestion (keep it); insert the new pending/none rows; for orphan ids no longer present, delete their `pending`/`none` rows; `pending` rows whose host+phrase changed become `stale` if the old phrase no longer matches (implement simply: old pending for that orphan with a different host/phrase → `stale`). Return counts.

- [ ] **Step 1: Mirror change + test** — in `mirror.ts` add `content?: { rendered?: string }` to `WpItem`, `content_html: string` to `MirroredPage`, `content` to `_fields`, set `content_html: it.content?.rendered ?? ""`. In `run.ts` map each page to `{ ...p, content_html: undefined, content_text: htmlToText(p.content_html), content_hash: sha1(text), word_count: text.split(/\s+/).filter(Boolean).length }` (build the object without `content_html`). Update the existing mirror test fixture (find with `grep -rn "mirrorSite" src --include='*.test.ts'`) so its expected object includes `content_html`.
- [ ] **Step 2: Fake store test** — `upsertScanResults` creates pending+none rows, keeps an identical pending, stales a changed one, removes rows for de-orphaned pages; `rejectedKeys` returns `${host}|${phrase}` for rejected rows.
- [ ] **Step 3: Implement both stores** (Supabase with `createAdminSupabase()`, casts through `unknown` as in `src/lib/plan/store.ts`; `counts` = `site_pages` count, `link_suggestions` pending count, approved count; `lastScan` = latest `keyword_imports` row with kind `link_scan`; `logScan` inserts one).
- [ ] **Step 4: Verify** — `npx vitest run src/lib/links src/lib/seo`, `npx tsc --noEmit -p .`, eslint. **Step 5: Commit** — `feat(links): mirror stores body text; LinksStore with Supabase and fake`.

---

### Task 7: Scan orchestration

**Files:** Create `src/lib/links/scan.ts`, `src/lib/links/scan.test.ts`

**Interfaces:**
- Consumes: `LinksStore`, `buildEdges`, `findOrphans`, `suggestFor`, `mirrorBrandSite` (Task 6; pass a `mirror` dependency so tests can stub it).
- Produces: `scanBrand(store: LinksStore, i: { brandId: string; userId: string | null; mirror?: (brandId: string) => Promise<{ pages: number } | { error: string }> }): Promise<{ pages: number; links: number; orphans: number; suggested: number; none: number } | { error: string }>`.

- [ ] **Step 1: Tests (fake store, stubbed mirror)** — `mirrorBrandSite` (Task 6) returns `mirrored: MirroredPage[]` with `content_html`; `scanBrand` re-reads `store.listPages` (for ids) and joins by `wp_id`+`type` (add `wp_id` and `type` to `PageLite` in Task 1's types if not present — `PageLite` already has `type`; add `wp_id: number`). Test: given a stub mirror returning three posts where A links to B, expect edges replaced with one edge, orphans = A and C, one pending suggestion for C (phrase in A or B) or a none verdict, `logScan` called with `"3 pages, 1 links, 2 orphans"`.
- [ ] **Step 2–4: Implement, GREEN, commit** — `feat(links): scan — mirror, rebuild graph, propose links`.

---

### Task 8: Approve / reject / undo (store + WP client) and server actions

**Files:** Create `src/lib/links/apply-actions.ts`, `src/lib/links/apply-actions.test.ts`, `src/lib/links/actions.ts`, `src/lib/links/queries.ts`

**Interfaces:**
- Produces: `approveSuggestion(store, i: { id: string; userId: string; wp: { getRaw(wpId: number): Promise<string>; update(wpId: number, content: string): Promise<void> } }): Promise<{ ok: true } | { ok: false; error: string; stale?: boolean }>`; `undoSuggestion(store, i: { id; userId; wp })`; server actions `scanAction(brandId | "all")`, `approveAction(id)`, `rejectAction(id)`, `undoAction(id)` returning `ActionResult`; `getLinksPageData(brandFilter: string | null)`.
- The `wp` adapter is built in `actions.ts` from `createWpClient(conn.config, conn.secret)`: `getRaw` = `client.get<{ content: { raw: string } }>(\`/wp/v2/posts/${id}\`, { context: "edit", _fields: "id,content" })` → `data.content.raw`; `update` = `updatePost(client, id, { content })`.

- [ ] **Step 1: Tests** — with a fake store and a fake `wp` (in-memory map of raw html): approve wraps and stores `href`/`undo_snippet`/status `approved` and adds an edge; approve when the phrase is gone → `{ ok:false, stale:true }` and status `stale`; undo restores html, status `undone`, edge removed; reject sets `rejected`.
- [ ] **Step 2–3: Implement + actions** — actions check the signed-in user (pattern from `src/lib/plan/actions.ts`), resolve the host page's `wp_id` and the brand's WordPress connection, call the core, `revalidatePath("/blog/links")` and `/blog`. `scanAction("all")` loops active brands sequentially and returns per-brand messages.
- [ ] **Step 4: queries** — `getLinksPageData(brandSlug | null)` → `{ brands, stats: { pages, pending, added }, lastScan, pending: SuggestionCard[], none: NoneCard[], added: AddedRow[] }` with titles/urls joined from `site_pages`.
- [ ] **Step 5: Verify + commit** — `feat(links): approve/undo/reject with WordPress writes; server actions and page data`.

---

### Task 9: `/blog/links` page + Blog header button

**Files:** Create `src/app/(app)/blog/links/page.tsx`, `src/components/links/scan-card.tsx`, `src/components/links/suggestion-card.tsx`, `src/components/links/none-card.tsx`, `src/components/links/added-list.tsx`; Modify `src/app/(app)/blog/page.tsx` header (add `Internal links →` and `Keywords & SEMrush →` buttons linking to `/blog/links` and `/seo`).

- Layout exactly per spec §UI: title "Internal links", description copy from the screenshot, three stat tiles, "Site last scanned …", scan card with **Scan for orphans** (uses `useTransition`, toast per brand), brand chips (`?brand=slug`), **Awaiting review** cards (orphan title + *Orphaned* badge, url, "Link from: host", context with `<mark>` on the phrase, Approve / Reject), empty state text verbatim, **Orphaned with no suggestion (N)** cards (verdict headline per reason: "The topic words are site-wide terms" / "Nowhere left to add it" / "No other article mentions the topic", explanation sentences from the screenshot, `<details>` "Phrases tried (n)"), **Links added (N)** `<details>` with Undo.
- Verify in the browser after Task 1's migration is applied: run a scan on JamSam Digital, approve one, check WP, undo.
- Commit — `feat(links): Internal links page and Blog header buttons`.

---

### Task 10: E2E + teardown

**Files:** Create `e2e/links.spec.ts`; Modify `e2e/global-teardown.ts` (add `site_pages?title=like.E2E%20page%20*` delete before brands).

- Seed via service role: brand (UI), two `site_pages` rows (`E2E page host`, `E2E page orphan`, with `content_text`), one `link_suggestions` pending row (host/orphan/phrase/context) and one `none` row with `phrases_tried`. Assert stats show "Awaiting review 1", the card renders the context with the phrase, Reject → "Nothing to approve…" empty state, the none card shows the reason and "Phrases tried (2)". No WordPress calls.
- Run `npx playwright test e2e/links.spec.ts`, full vitest, tsc, eslint. Commit — `test(links): e2e review flow and teardown`. Do not push/PR (controller does).

---

## Self-review

- **Spec coverage**: data model → T1; mirror with content → T6; graph/orphans → T3; suggestions incl. site-wide/rejected/stale rules → T4 + T6 (`upsertScanResults`) + T7; apply/undo/reject → T5 + T8; UI incl. header button → T9; `link_scan` import log → T6/T7; tests → each task + T10.
- **Placeholders**: T6–T9 give interfaces and semantics but not every line of code; implementers must follow the stated signatures exactly.
- **Type consistency**: `PageLite.content_text` is always a string (store maps null → ""); `Suggestion`/`NoneVerdict` shapes shared by T4, T6, T7; rejected key format `${hostId}|${phrase}` in T4 and T6; `LinkSuggestionStatus` values match the migration enum.
