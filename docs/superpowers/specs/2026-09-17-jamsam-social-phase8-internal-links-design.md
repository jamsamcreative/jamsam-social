# JamSam Social — Phase 8: Internal Links

**Date:** 2026-09-17
**Status:** Approved in conversation; written for execution
**Builds on:** Phase 3 (WordPress client, push), Phase 5b (site mirror `site_pages`, `mirrorSiteNow`, keywords), Phase 7 UI conventions

## Purpose

Find published pages on a brand's WordPress site that nothing else on the site links to, propose an exact phrase in an existing blog post that can be wrapped in a link to each orphan, and — on approval — write that link into the live post. Nothing is rewritten and no sentences are invented; approving wraps words that are already there. Orphans with no safe phrase are listed with the phrases tried so they can be linked by hand. Modelled on SSA Social's Internal Links page.

## Decisions carried from brainstorming

- **Approval writes to WordPress immediately**, with an undo record per link added.
- **No Claude in the loop**: matching is deterministic; no-match orphans are listed for hand edits.
- **Graph rules**: a page is orphaned when no *other* post's or page's **body** content links to it. Theme menus, sidebars, category/tag archives and other index pages do not count (the REST API does not expose theme nav anyway). New links are only ever inserted into **published blog posts**, never into static pages.
- **Architecture (approach A)**: extend the existing site mirror to fetch body content, build the link graph and suggestions in pure functions, store them, and apply approved links through the existing WP client.

## Out of scope

Editing static pages, nav menus, external links, anchor-text optimisation of existing links, redirect/broken-link checking, multi-link suggestions per orphan, Claude-written sentences (revisit if hand edits pile up).

## Data model

Migration `0012_internal_links.sql`:

```sql
alter table site_pages add column content_text text;          -- body as plain text (for phrase search)
alter table site_pages add column content_hash text;          -- sha1 of content_text; skip re-matching when unchanged
alter table site_pages add column word_count int;

-- Rebuilt on every scan: one row per internal body link
create table site_links (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  from_page_id uuid not null references site_pages(id) on delete cascade,
  to_page_id   uuid not null references site_pages(id) on delete cascade,
  href         text not null,
  anchor_text  text not null default '',
  scanned_at   timestamptz not null default now()
);
create index site_links_to on site_links (brand_id, to_page_id);
create index site_links_from on site_links (brand_id, from_page_id);

create type link_suggestion_status as enum ('pending','approved','rejected','undone','stale','none');

-- One row per orphan per scan outcome. host_page_id null + status 'none' = orphan with no suggestion.
create table link_suggestions (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references brands(id) on delete cascade,
  orphan_page_id uuid not null references site_pages(id) on delete cascade,
  host_page_id   uuid references site_pages(id) on delete cascade,
  phrase         text,                                        -- exact words in the host to wrap
  context        text,                                        -- the sentence containing the phrase, for the card
  status         link_suggestion_status not null default 'pending',
  reason         text,                                        -- for 'none': why nothing could be proposed
  phrases_tried  text[] not null default '{}',
  href           text,                                        -- orphan url written into the host
  undo_snippet   text,                                        -- exact <a …>phrase</a> that was written
  applied_at     timestamptz,
  applied_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger link_suggestions_updated_at before update on link_suggestions for each row execute function set_updated_at();
create index link_suggestions_brand_status on link_suggestions (brand_id, status);
-- A rejected (orphan, host, phrase) triple is never re-proposed.
create unique index link_suggestions_unique_pending on link_suggestions (brand_id, orphan_page_id) where status = 'pending';

alter table site_links enable row level security;
alter table link_suggestions enable row level security;
create policy "authenticated read" on site_links for select to authenticated using (true);
create policy "authenticated read" on link_suggestions for select to authenticated using (true);
```

`keyword_imports` gets a new kind `'link_scan'` row per scan (detail = "N pages, M links, K orphans") so "Site last scanned" and freshness reuse the existing import log. `database.types.ts` is hand-updated.

## Scan (`src/lib/links/`)

Triggered by **Scan for orphans** on the page (server action, `maxDuration = 300`), one brand at a time; "All brands" runs them in sequence and reports per brand.

1. **Mirror with content** (`mirror.ts`, extends `mirrorSite`): request `_fields=id,slug,link,modified_gmt,title,excerpt,content,meta,_links,_embedded` for `posts` and `pages` (public REST, `status=publish`). Store `content_text` = `htmlToText(content.rendered)` (Gutenberg block comments, scripts, styles and tags stripped; whitespace collapsed), `content_hash`, `word_count`. Replace-all semantics as today.
2. **Link graph** (`graph.ts`, pure): `extractInternalLinks(html, siteOrigin) → { href, anchorText }[]` (absolute, root-relative and protocol-relative hrefs; strip `#fragment`, `?query`, trailing slash; ignore `mailto:`, `tel:`, media file URLs); `resolveLinks(links, pages) → to_page_id` by normalised URL, falling back to slug match. Rebuild `site_links` for the brand.
3. **Orphans** (`graph.ts`, pure): `findOrphans(pages, links)` = pages with zero inbound links from a *different* page. Home page (slug `/` or `front-page`) and pages of type `page` whose slug is in a small ignore list (`privacy-policy`, `terms`, `thank-you`, `sitemap`) are still reported but flagged `utility: true` and sorted last.
4. **Suggestions** (`suggest.ts`, pure):
   - Candidate phrases for an orphan, in priority order: `focus_keyword`; title; title with a trailing `: subtitle` / ` – subtitle` removed; contiguous 2–4-word n-grams of the title minus stop words; each lower-cased and de-duplicated, minimum 2 words (single words only if the focus keyword is one word).
   - **Site-wide terms**: a phrase occurring in more than 40 % of posts (min 5 posts) is skipped with reason `site-wide term`.
   - Hosts: published **posts** (type `post`) other than the orphan that do not already link to the orphan, whose `content_text` contains the phrase as whole words (case-insensitive, Unicode-aware boundaries).
   - Pick: longest phrase first; among hosts, most title-token overlap with the orphan, then the most recently modified. Produce exactly one `pending` suggestion with `context` = the containing sentence (± 120 chars).
   - No host → `status 'none'` with `reason` ∈ {`site-wide term`, `only inside itself or in posts that already link here`, `no other post mentions the topic`} and `phrases_tried`.
   - A previously **rejected** (orphan, host, phrase) is never re-proposed; a pending suggestion whose phrase no longer occurs in the host is marked `stale`; an orphan that is no longer orphaned has its pending/none rows deleted (approved/undone rows are history and stay).

## Apply / undo (`src/lib/links/apply.ts`, pure + WP client)

- `wrapPhrase(rawHtml, phrase, href) → { html, snippet } | null`: split the raw post content into segments; only text **outside** `<a>…</a>`, `<h1>`–`<h6>`, `<code>`/`<pre>`, HTML tags and `<!-- wp:… -->` comments is searchable; wrap the **first** whole-word, case-insensitive occurrence as `<a href="{href}">{original words}</a>`; return null when not found. Idempotent: if the same snippet already exists, return the input unchanged.
- `unwrapSnippet(rawHtml, snippet) → html | null`: exact string replace of the snippet with its inner text.
- **Approve** (server action): load the suggestion; fetch the host with `getPost(client, wp_id)` using `context=edit` (needs the brand's WordPress connection, already used by push); `wrapPhrase` on `content.raw`; on null → mark `stale` and return an error ("Post changed since the scan — rescan"); else `updatePost(client, wp_id, { content })`, store `href`, `undo_snippet`, `applied_at/by`, status `approved`; insert the new `site_links` row so the orphan count updates without a rescan.
- **Undo**: fetch, `unwrapSnippet`, update, status `undone`, delete that `site_links` row.
- **Reject**: status `rejected`.
- The WP write path reuses `createWpClient` + the existing `updatePost`; a `fetchImpl` override is threaded through for tests.

## UI — `/blog/links` (link "Internal links →" in the Blog header)

- Header copy from the screenshot; stats: **Pages mirrored**, **Awaiting review**, **Links added**; "Site last scanned …"; **Scan the sites** card with **Scan for orphans** (spinner, per-brand result toast); brand filter chips (All brands / each brand).
- **Awaiting review**: card per pending suggestion — orphan title (badge *Orphaned*) + url; "Link from: *host title*"; the context sentence with the phrase highlighted; **Approve** / **Reject**. Empty state: "Nothing to approve. The orphaned posts below need a link written by hand."
- **Orphaned with no suggestion (N)**: card per `none` row — title, url, brand, verdict headline + explanation (the three reasons, worded as in the screenshot), "Phrases tried (n)" expander.
- **Links added (N)**: collapsible history — orphan ← host, phrase, applied date, **Undo**.
- Blog page header gets the **Internal links →** button next to *Keywords & SEMrush →* (which links to `/seo`).

## Testing

- Pure (`src/lib/links/*.test.ts`): `htmlToText` (Gutenberg comments, scripts, nested tags, entities), `extractInternalLinks` (absolute/relative/fragments/media/external), `resolveLinks` (trailing slash, slug fallback), `findOrphans` (self-links don't count, utility flag), candidate phrase generation, site-wide-term filter, host selection ordering, `wrapPhrase` (skips anchors/headings/code/comments, first occurrence only, whole words, idempotent, null when absent), `unwrapSnippet`.
- Scan orchestration against a fake store + stubbed `fetchImpl` WP responses: graph rebuilt, suggestions created/staled/deleted per the rules, rejected triples not re-proposed, `link_scan` import logged.
- Apply/undo against a stubbed WP client: content written, `site_links` row added/removed, stale handling.
- E2E: seed `site_pages` (+content) and a pending `link_suggestions` row via the service role; the page shows stats and the card, Reject moves it out of review, and the no-suggestion list renders a seeded `none` row with its phrases. Approve (a live WordPress write) is covered by the stubbed-client unit tests and the manual check, not e2e. Teardown removes `site_links`/`link_suggestions` via the brand cascade.
- Manual: run a real scan on jamsamdigital.com, approve one link, check the post in WP, undo it.
