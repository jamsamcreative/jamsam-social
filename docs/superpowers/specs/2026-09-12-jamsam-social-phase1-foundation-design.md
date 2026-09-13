# JamSam Social — Phase 1: Foundation

**Date:** 2026-09-12
**Status:** Draft for review
**Owner:** JamSam Digital (Jamie Sampson)

## Purpose

JamSam Social is a multi-client marketing-ops platform for JamSam Digital, modelled on SSA Social (the Steel Structures America tool) but fully separate: its own repo, Supabase project, Vercel project, and clients. Each client is a *brand* with its own website, WordPress, Meta (Facebook/Instagram), Pinterest, keyword research, and content bank.

Phase 1 delivers the foundation every later phase builds on: the app scaffold, team login, brand/client management with integration connections, brand guideline documents, and a media library. It ships deployed to Vercel and usable on its own (a working client directory and asset library), even before any publishing exists.

## Roadmap (context, not Phase 1 scope)

| Phase | Deliverable | Depends on |
|---|---|---|
| 1. Foundation | Scaffold, auth, brands + connections, guidelines, media library | — |
| 2. Social posts | Composer, approval, cron publisher to Meta, recycled posts, calendar | 1 |
| 3. Articles → WordPress | Article editor with SEO fields, push-to-WP with image re-hosting | 1 |
| 4. AI layer | `generation_jobs` queue, MCP server route, in-app generate via Claude API, content-mix tracking | 1–3 |
| 5. SEO intelligence | Keyword opportunities (CSV + SEMrush API), cannibalization check, content bank | 1, 3 |
| 6. Pinterest | Boards sync, pin drafts, scheduling, publish, per-board stats | 1, 4 |

Each phase gets its own spec and implementation plan.

## Infrastructure (already provisioned)

- GitHub: `github.com/jamsamcreative/jamsam-social` (currently empty)
- Vercel: project linked to that repo
- Supabase: `https://dpihndeejbirskdrjfeh.supabase.co`

## Stack

- Next.js 15 (App Router, TypeScript, Server Actions + Route Handlers)
- Supabase: Auth, Postgres, Storage; `@supabase/ssr` for server/client helpers
- Tailwind CSS + shadcn/ui
- Vitest (unit), Playwright (smoke)
- Deployed on Vercel; Vercel Cron in later phases

## Architecture principles (apply to all phases)

1. **Multi-tenant by `brand_id`.** Every content table carries `brand_id`. Phase 1 access policy is "any authenticated user can read/write everything" because only the JamSam team logs in. Client logins later are a policy change, not a schema change.
2. **Secrets never reach the browser.** Per-brand credentials (WP app password, Meta tokens, Pinterest tokens, SEMrush key) live in `brand_connections.secret` encrypted with an app-level AES-256-GCM key held in `CONNECTIONS_ENCRYPTION_KEY` (Vercel env). Encryption/decryption happens only in server code. The service-role key is used only in server code.
3. **One deploy.** Web app, API routes, cron handlers, and (Phase 4) the MCP server all live in this Next.js project.
4. **Status machines, not booleans.** Anything that publishes moves through explicit statuses (`draft → pending_approval → approved → publishing → published | failed`). Phase 1 only defines the pattern; Phase 2 uses it.

## Phase 1 scope

### In
- Project scaffold, linting, CI (GitHub Actions: typecheck, lint, unit tests)
- Supabase migrations under `supabase/migrations`, run via Supabase CLI
- Auth: email + password login via Supabase Auth; no public signup. Users are invited from the Supabase dashboard. Login page copy: "JamSam Digital team access only."
- App shell: sidebar nav (Dashboard, Brands, Media), brand switcher in header, JamSam Digital branding
- Brands: list, create, edit, archive
- Brand connections: per-brand settings tabs for Website/WordPress, Meta, Pinterest, SEMrush, each with "Test connection" that makes a real API call server-side and reports success/failure
- Brand guideline documents: markdown docs per brand, of kind `social_style | social_post_spec | blog_style | blog_post_spec | pin_spec`; edit in-app
- Media library: upload images to Supabase Storage (bucket `media`, path `{brand_id}/{uuid}.{ext}`), per-brand grid, alt text + tags, delete
- Dashboard: brand cards with connection health (connected / not connected / failing)
- Deployed to Vercel with env vars set; `main` auto-deploys

### Out (later phases)
- Posts, articles, pins, jobs, keywords, content bank, MCP, cron

## Data model

```sql
-- Brands (clients)
create table brands (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,           -- 'acme-roofing'
  name        text not null,
  website_url text,
  timezone    text not null default 'America/Los_Angeles',
  seo_suffix  text,                            -- appended to seo_title, e.g. ' | Acme Roofing'
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One row per integration per brand
create type connection_provider as enum ('wordpress','meta','pinterest','semrush');
create type connection_status   as enum ('not_connected','connected','failing');

create table brand_connections (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  provider      connection_provider not null,
  config        jsonb not null default '{}',   -- non-secret: site_url, page_id, ig_user_id, board defaults
  secret        text,                           -- AES-256-GCM ciphertext (base64) of a JSON blob of secrets
  status        connection_status not null default 'not_connected',
  last_checked  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (brand_id, provider)
);

-- Guideline documents
create type guideline_kind as enum ('social_style','social_post_spec','blog_style','blog_post_spec','pin_spec');

create table brand_guidelines (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references brands(id) on delete cascade,
  kind       guideline_kind not null,
  body_md    text not null default '',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (brand_id, kind)
);

-- Media library
create table media_assets (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  storage_path text not null,                   -- '{brand_id}/{uuid}.jpg'
  public_url   text not null,
  filename     text not null,
  mime_type    text not null,
  width        int,
  height       int,
  alt_text     text,
  tags         text[] not null default '{}',
  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create index on media_assets (brand_id, created_at desc);
```

**Connection `config` / `secret` shapes**

| provider | config (jsonb) | secret (decrypted JSON) |
|---|---|---|
| wordpress | `{ site_url, username }` | `{ app_password }` |
| meta | `{ page_id, page_name, ig_user_id, ig_username }` | `{ page_access_token, expires_at }` |
| pinterest | `{ ad_account_id?, username }` | `{ access_token, refresh_token, expires_at }` |
| semrush | `{ database: 'us' }` | `{ api_key }` |

**RLS:** enabled on all four tables. Policy for each: `authenticated` role may `select/insert/update/delete`. `brand_connections.secret` is additionally hidden from the browser by never selecting it in client-facing queries; only server code using the service-role client reads it.

**Storage:** bucket `media`, public read, authenticated write via signed upload from a Server Action.

## Components

```
src/
  app/
    (auth)/login/page.tsx
    (app)/layout.tsx                 -- shell: sidebar, header, brand switcher
    (app)/dashboard/page.tsx
    (app)/brands/page.tsx
    (app)/brands/new/page.tsx
    (app)/brands/[slug]/page.tsx     -- overview
    (app)/brands/[slug]/connections/page.tsx
    (app)/brands/[slug]/guidelines/page.tsx
    (app)/media/page.tsx
    api/connections/[id]/test/route.ts
  lib/
    supabase/{client,server,admin}.ts
    crypto.ts                        -- encrypt/decrypt(secret) with CONNECTIONS_ENCRYPTION_KEY
    connections/
      types.ts
      wordpress.ts                   -- test(): GET /wp-json/wp/v2/users/me with app password
      meta.ts                        -- test(): GET /{page_id}?fields=name,instagram_business_account
      pinterest.ts                   -- test(): GET /v5/user_account
      semrush.ts                     -- test(): cheap analytics call, check units
    brands.ts                        -- server actions: create/update/archive
    media.ts                         -- server actions: upload/delete/update meta
  components/
    shell/{sidebar,header,brand-switcher}.tsx
    brands/{brand-form,connection-card,guideline-editor}.tsx
    media/{upload-dropzone,asset-grid,asset-dialog}.tsx
supabase/
  migrations/0001_foundation.sql
  seed.sql                           -- optional: a 'jamsam-digital' demo brand
```

Each `lib/connections/<provider>.ts` exposes `{ test(config, secret): Promise<{ ok: boolean; detail?: string; error?: string }> }` so Phase 2/3/6 add `publish`/`push` beside `test` without changing the settings UI.

## Data flow: connecting a brand's WordPress

1. User opens `/brands/acme/connections`, WordPress tab, enters site URL, username, application password, clicks Save & Test.
2. Server Action validates input (zod), encrypts `{ app_password }` with `encrypt()`, upserts `brand_connections` row with `status='not_connected'`.
3. Action calls `wordpress.test(config, secret)`; on success sets `status='connected'`, `last_checked=now()`; on failure `status='failing'`, `last_error=<message>`.
4. UI re-renders card with a green/red badge and the error text if any.

Meta and Pinterest in Phase 1 accept a pasted long-lived token (obtained from Graph API Explorer / Pinterest developer console). OAuth "Connect" buttons are a Phase 2/6 enhancement.

## Error handling

- All Server Actions return `{ ok, error? }` and never throw to the client; UI shows toast.
- Connection tests have a 10 s timeout; network failures set `failing` with a readable message.
- Uploads limited to 20 MB, image MIME types only; rejected files reported inline.
- Missing `CONNECTIONS_ENCRYPTION_KEY` fails fast at startup with a clear message.

## Testing

- **Unit (Vitest):** `crypto.ts` round-trip; each `connections/*.test()` against mocked fetch (success, 401, timeout); brand slug generation/uniqueness; zod schemas.
- **Smoke (Playwright, against local dev + local Supabase):** login → create brand → upload image → see it in library.
- **CI:** GitHub Actions runs typecheck, lint, Vitest on every PR.

## Environment variables

| Name | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + local | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + local | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + local (server only) | Admin client |
| `CONNECTIONS_ENCRYPTION_KEY` | Vercel + local | 32-byte base64 key for secrets |
| `NEXT_PUBLIC_APP_URL` | Vercel + local | Absolute URL for links |

## Definition of done (Phase 1)

- `main` deploys to Vercel; login works with an invited user.
- A brand can be created, edited, archived; at least one real WordPress and one real Meta connection test green against a live client.
- Guideline docs can be written and saved for a brand.
- Images upload to Supabase Storage and appear in the per-brand library with alt/tags.
- CI green; unit + smoke tests pass.
