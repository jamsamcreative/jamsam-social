# JamSam Social — Phase 3: Articles → WordPress

**Date:** 2026-09-13
**Status:** Approved in conversation; written for execution
**Builds on:** Phase 1 (brands, connections, media), Phase 2 (workflow patterns)

## Purpose

Write SEO blog articles in-app for a client brand, push them to the brand's WordPress site as drafts (with images re-hosted into the WP media library and Yoast SEO fields set), and publish them from the app. This is the foundation the AI layer (Phase 4) and SEO intelligence (Phase 5) write into.

## Decisions carried from brainstorming

- SEO plugin: **Yoast SEO**. Yoast fields are written through a small helper plugin the app serves; push still works without it (SEO fields skipped with a warning).
- Editor: **Tiptap** rich text with an HTML source toggle; stored as clean HTML.
- Workflow: **draft → pushed_to_wp → published** (+ `archived`). No approval step. A **Publish** button flips the WP draft to `publish` (or `future` with a date). **Sync from WP** re-reads status/link.

## Out of scope

AI drafting (Phase 4), keyword opportunities / internal-link suggestions / cannibalization (Phase 5), Rank Math support, comments, revisions, categories/tags creation (only selection of existing terms).

## Data model

```sql
create type article_status   as enum ('draft','pushed_to_wp','published','archived');
create type article_decision as enum ('new','rewrite','optimize');
create type article_source   as enum ('manual','ai');

create table articles (
  id                 uuid primary key default gen_random_uuid(),
  brand_id           uuid not null references brands(id) on delete cascade,
  title              text not null,
  slug               text not null,
  content_html       text not null default '',
  excerpt            text,
  seo_title          text,
  meta_description   text,
  primary_keyword    text,
  secondary_keywords text[] not null default '{}',
  featured_media     jsonb,            -- { url, alt, media_asset_id? }
  categories         jsonb not null default '[]',  -- [{ id, name }] WP terms
  tags               jsonb not null default '[]',  -- [{ id, name }]
  decision           article_decision not null default 'new',
  rationale          text,
  source             article_source not null default 'manual',
  status             article_status not null default 'draft',
  wp_post_id         int,
  wp_link            text,
  wp_status          text,             -- draft | publish | future | pending | private (as reported by WP)
  pushed_at          timestamptz,
  published_at       timestamptz,
  last_error         text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (brand_id, slug)
);

-- Remembers which external image URL became which WP media item, so re-pushes don't re-upload.
create table article_media_map (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  source_url   text not null,
  wp_media_id  int not null,
  wp_url       text not null,
  created_at   timestamptz not null default now(),
  unique (brand_id, source_url)
);
```

RLS: authenticated full access, same as prior phases. `updated_at` trigger on `articles`.

## WordPress connector (`src/lib/wordpress/`)

- `wpClient(config, secret)` returns `{ get, post, patch }` over `${site_url}/wp-json/wp/v2` with Basic auth (`wpAuthHeader` from Phase 1), 20 s timeout, JSON error → thrown `WpError(message, status)`.
- `listTerms(client, 'categories' | 'tags')` → `[{ id, name }]` (paginated, `per_page=100`).
- `uploadMediaFromUrl(client, url, { alt, filename })` → downloads the bytes server-side, `POST /media` with `Content-Disposition`, then `PATCH /media/{id}` to set `alt_text`; returns `{ id, source_url }`.
- `createPost/updatePost(client, payload)`; `getPost(client, id)` selecting `id,link,status,date,slug`.
- `checkHelper(client)` → `GET /wp-json/jamsam/v1/ping` → `{ installed: boolean, version?: string }`.
- Phase 1's WordPress connection test is extended to report the helper status in its detail string ("Signed in as Jamie (administrator). JamSam helper: installed" / "not installed").

## Yoast helper plugin

Served at `GET /api/wp-plugin/jamsam-connector.zip` (generated on the fly from a PHP string; download link shown on the brand's WordPress connection card). Contents:

```php
<?php
/*
Plugin Name: JamSam Connector
Description: Lets JamSam Social set Yoast SEO fields through the REST API.
Version: 1.0.0
*/
add_action('init', function () {
  foreach (['_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_focuskw'] as $key) {
    register_post_meta('post', $key, [
      'show_in_rest' => true, 'single' => true, 'type' => 'string',
      'auth_callback' => function () { return current_user_can('edit_posts'); },
    ]);
  }
});
add_action('rest_api_init', function () {
  register_rest_route('jamsam/v1', '/ping', [
    'methods' => 'GET',
    'permission_callback' => function () { return current_user_can('edit_posts'); },
    'callback' => function () { return ['ok' => true, 'version' => '1.0.0']; },
  ]);
});
```

## Push (`pushArticle(id)`)

1. Validate: title, slug (`^[a-z0-9-]+$`), non-empty content, featured image present. `seo_title` defaults to title; the brand's `seo_suffix` is appended when set and missing. `meta_description` outside 120–156 chars produces a warning in the result, not a block.
2. Re-host images: parse `content_html` for `<img src="...">`; for each `src` not on the brand's `site_url` host, look up `article_media_map`, else `uploadMediaFromUrl` and insert the map row; rewrite `src`. Same for the featured image (yields `featured_media` WP id).
3. Payload: `{ title, slug, content, excerpt, status: 'draft', categories: ids, tags: ids, featured_media, meta: { _yoast_wpseo_title, _yoast_wpseo_metadesc, _yoast_wpseo_focuskw } }`. `meta` is sent only when the helper is installed (checked at push time; result cached on the connection config as `helper_installed`).
4. Create when `wp_post_id` is null, else update. Store `wp_post_id`, `wp_link`, `wp_status`, `pushed_at`, `last_error=null`, `content_html` (with rewritten srcs), status → `pushed_to_wp` (unless already `published`, which stays `published`).
5. Any failure: `last_error` set, status unchanged, error returned to the UI.

## Publish and sync

- `publishArticle(id, dateLocal?)`: requires `wp_post_id`. `updatePost({ status: 'publish' })`, or `{ status: 'future', date: <ISO in brand tz> }` when a future date is given. Reads back `link/status/date`; sets `published_at`, `wp_status`, `status='published'`.
- `syncArticle(id)`: `getPost` → updates `wp_status`, `wp_link`; if WP says `publish`, status → `published` and `published_at` from WP `date_gmt`.
- Unpublish is out of scope; use wp-admin.

## UI

Routes: `/articles` (list, status filter, brand from header), `/articles/new`, `/articles/[id]`.

Editor page layout: two columns. Left: title input, Tiptap editor (StarterKit + Link + Image; toolbar: H2/H3, bold, italic, bullet/ordered list, link, image via media picker, HTML source toggle using a `<textarea>`). Right: slug (auto from title until edited), excerpt, featured image (media picker, single), categories and tags (multi-select from WP; "Load from WordPress" button, cached per brand in `brand_connections.config.wp_terms` with a timestamp), SEO panel (SEO title with live length and suffix preview, meta description with counter and 120–156 hint, focus keyword, secondary keywords comma-separated), decision select + rationale.

Actions bar: Save · Push to WordPress · Publish (dialog with optional date) · Sync from WP · Open in wp-admin (`{site_url}/wp-admin/post.php?post={id}&action=edit`) · Archive. Buttons enable per status. `last_error` shown inline.

Sidebar gains **Articles** (after Calendar). Dashboard cards gain "n article drafts".

## Environment

No new env vars. Uses the brand's WordPress connection (Phase 1).

## Testing

- Unit: image URL extraction + rewrite (`rehostImages` with an injected uploader), SEO title suffix logic, meta description warning, push payload builder (with/without helper), slugify reuse, publish payload (`future` + date), term parsing.
- Integration (manual, plan step): push and publish against the user's test WordPress site; verify featured image, body images in WP media, Yoast fields in wp-admin.
- Playwright: create article → save → shows in list; push/publish exercised only when `E2E_WP=1` (needs a connected site).

## Definition of done

- Helper plugin downloads from the app and installs on a WP site; connection test reports "installed".
- An article with two body images and a featured image pushes as a WP draft with all images in the WP media library and Yoast title/description/keyword set.
- Publish from the app makes it live and records the link; Sync reflects a publish done in wp-admin.
- CI green, deployed to production.
