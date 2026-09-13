# JamSam Social Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed Next.js + Supabase app where the JamSam Digital team can log in, manage client brands, connect each brand's WordPress/Meta/Pinterest/SEMrush credentials (with a real "test connection"), write brand guideline docs, and upload images to a per-brand media library.

**Architecture:** Single Next.js App Router project on Vercel. Supabase provides Auth, Postgres (with RLS) and Storage. All writes go through Server Actions; third-party credentials are AES-256-GCM encrypted server-side and never sent to the browser. Each integration lives in `src/lib/connections/<provider>.ts` behind one `test()` interface so later phases add `publish()`/`push()` beside it.

**Tech Stack:** Next.js 16 (App Router, TypeScript), `@supabase/ssr` + `@supabase/supabase-js`, Tailwind CSS v4, shadcn/ui, zod, sharp, Vitest, Playwright, GitHub Actions, Supabase CLI (via `npx supabase`), Vercel CLI (via `npx vercel`).

**Spec:** `docs/superpowers/specs/2026-09-12-jamsam-social-phase1-foundation-design.md`

## Global Constraints

- Node 24 (`node -v` → v24.x). Package manager: **npm** (lockfile `package-lock.json`).
- Next.js: spec says 15; `create-next-app@latest` now installs **16.x**. Use 16 — App Router APIs are the same. In 16 the request middleware file is `src/proxy.ts` exporting `proxy` (if the scaffold produced Next 15, name it `src/middleware.ts` exporting `middleware` — identical body).
- Login page copy is exactly: **"JamSam Digital team access only."** No public signup.
- Every content table has `brand_id`. RLS enabled everywhere; policy = `authenticated` full access.
- `brand_connections.secret` is only ever read via the **admin (service-role) client in server code**. Never select it in a query that feeds a Client Component.
- All Server Actions return `{ ok: true, ... } | { ok: false, error: string }`; they never throw to the client.
- Connection tests time out at **10 s**. Uploads: **20 MB max, image/* only**.
- Supabase project: `https://dpihndeejbirskdrjfeh.supabase.co` (ref `dpihndeejbirskdrjfeh`). GitHub: `jamsamcreative/jamsam-social`. Vercel project already linked to that repo.
- Commit after every task with a Conventional Commit message. Work on the current branch `i-want-to-create-my-own-versio`; Task 15 merges to `main`.
- No em dashes in UI copy (brand rule carried over from SSA; keep it consistent).

---

### Task 1: Scaffold the Next.js app with Tailwind, shadcn/ui, Vitest, and CI

**Files:**
- Create: whole project via `create-next-app`, then `vitest.config.ts`, `src/test/setup.ts`, `.github/workflows/ci.yml`, `.env.example`, `README.md`
- Modify: `package.json` (scripts), `.gitignore`

**Interfaces:**
- Produces: `npm run dev|build|lint|typecheck|test`; shadcn components under `src/components/ui/*`; `@/` alias → `src/`.

- [ ] **Step 1: Scaffold Next.js into the current (nearly empty) directory**

Run from the worktree root:

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack --yes
```

If it refuses because the directory is not empty (it contains `.git` and `docs/`), run it into a temp dir and move the contents up:

```bash
npx create-next-app@latest /tmp/jamsam-scaffold --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack --yes
rsync -a --exclude .git /tmp/jamsam-scaffold/ ./
rm -rf /tmp/jamsam-scaffold
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: "Compiled successfully", route `/` listed.

- [ ] **Step 3: Install runtime and dev dependencies**

```bash
npm install @supabase/ssr @supabase/supabase-js zod sharp sonner
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom @playwright/test
```

- [ ] **Step 4: Initialise shadcn/ui and add the components Phase 1 uses**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button card input label textarea badge tabs dialog select separator dropdown-menu skeleton
```

Accept defaults (New York style, neutral base color, CSS variables). This creates `src/components/ui/*` and `src/lib/utils.ts` (`cn()` helper).

- [ ] **Step 5: Add Vitest config and test setup**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
    env: {
      // Deterministic test key: 32 zero bytes, base64. Real key lives in .env.local / Vercel.
      CONNECTIONS_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

Create `src/test/setup.ts`:

```ts
// Global test setup. Kept empty on purpose; per-file mocks live in each test.
export {};
```

- [ ] **Step 6: Add npm scripts**

In `package.json` `"scripts"`, set:

```json
"dev": "next dev",
"build": "next build",
"start": "next start",
"lint": "eslint .",
"typecheck": "tsc --noEmit",
"test": "vitest run",
"test:watch": "vitest",
"e2e": "playwright test"
```

- [ ] **Step 7: Add `.env.example`**

```bash
# Supabase (Project Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://dpihndeejbirskdrjfeh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# 32 random bytes, base64. Generate: openssl rand -base64 32
CONNECTIONS_ENCRYPTION_KEY=

# Absolute URL of this deployment
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Playwright smoke test user (an invited Supabase Auth user)
E2E_EMAIL=
E2E_PASSWORD=
```

Ensure `.gitignore` contains `.env*.local`, `.env`, `playwright-report/`, `test-results/`.

- [ ] **Step 8: Add GitHub Actions CI**

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
```

- [ ] **Step 9: Write a trivial test so `npm test` has something to run**

Create `src/lib/utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("merges tailwind classes, last wins on conflict", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
```

- [ ] **Step 10: Run everything**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass, 1 test green.

- [ ] **Step 11: Replace README**

`README.md`:

```markdown
# JamSam Social

Multi-client marketing-ops platform for JamSam Digital. Next.js + Supabase on Vercel.

## Local setup
1. `cp .env.example .env.local` and fill in values (see spec for where each comes from).
2. `npm install`
3. `npm run dev` → http://localhost:3000

## Database
Migrations live in `supabase/migrations`. Apply with `npx supabase db push` (after `npx supabase link --project-ref dpihndeejbirskdrjfeh`).

## Tests
- `npm test` — unit (Vitest)
- `npm run e2e` — Playwright smoke (needs E2E_EMAIL/E2E_PASSWORD in .env.local)

Specs and plans: `docs/superpowers/`.
```

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Tailwind, shadcn/ui, Vitest, CI"
```

---

### Task 2: Environment validation and Supabase clients

**Files:**
- Create: `src/lib/env.ts`, `src/lib/env.test.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/lib/supabase/proxy.ts`, `src/proxy.ts`

**Interfaces:**
- Produces:
  - `env` object: `{ NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CONNECTIONS_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL }` (all strings, validated).
  - `createClient()` (browser), `createServerSupabase()` (server components/actions, cookie-bound, respects RLS), `createAdminSupabase()` (service role, server only).
  - `proxy` (Next 16 request handler) that refreshes the Supabase session and redirects unauthenticated users from `/(app)` routes to `/login`.

- [ ] **Step 1: Write failing env test**

`src/lib/env.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

const good = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CONNECTIONS_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("accepts a complete env", () => {
    expect(parseEnv(good).NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });
  it("fails fast with a clear message when the encryption key is missing", () => {
    const { CONNECTIONS_ENCRYPTION_KEY: _drop, ...rest } = good;
    expect(() => parseEnv(rest)).toThrow(/CONNECTIONS_ENCRYPTION_KEY/);
  });
  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() => parseEnv({ ...good, CONNECTIONS_ENCRYPTION_KEY: "c2hvcnQ=" })).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/env.test.ts`
Expected: FAIL, cannot resolve `@/lib/env`.

- [ ] **Step 3: Implement `src/lib/env.ts`**

```ts
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CONNECTIONS_ENCRYPTION_KEY: z
    .string({ error: "CONNECTIONS_ENCRYPTION_KEY is required (openssl rand -base64 32)" })
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "CONNECTIONS_ENCRYPTION_KEY must decode to exactly 32 bytes",
    }),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return result.data;
}

// Server-only. Browser code must read process.env.NEXT_PUBLIC_* directly.
export const env: Env = parseEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  CONNECTIONS_ENCRYPTION_KEY: process.env.CONNECTIONS_ENCRYPTION_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/env.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Create the three Supabase clients**

`src/lib/supabase/client.ts` (browser):

```ts
"use client";
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

`src/lib/supabase/server.ts` (server components + server actions, user-scoped):

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there.
          // The proxy refreshes sessions, so this is safe to ignore.
        }
      },
    },
  });
}
```

`src/lib/supabase/admin.ts` (service role, bypasses RLS; server only):

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export function createAdminSupabase() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

Install the guard package: `npm install server-only`.

- [ ] **Step 6: Create the session-refresh proxy**

`src/lib/supabase/proxy.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getUser() validates the JWT with Supabase and refreshes cookies if needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
```

`src/proxy.ts` (Next 16; for Next 15 name it `src/middleware.ts` and export `middleware`):

```ts
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 7: Create `.env.local` with real values**

Fill from the Supabase dashboard (Project Settings → API) and generate the key:

```bash
cp .env.example .env.local
openssl rand -base64 32   # paste as CONNECTIONS_ENCRYPTION_KEY
```

Ask the user for the anon and service-role keys if not already available in the environment.

- [ ] **Step 8: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: env validation, Supabase clients, and session-refresh proxy"
```

---

### Task 3: Database migration (tables, enums, RLS, storage bucket)

**Files:**
- Create: `supabase/config.toml` (generated), `supabase/migrations/0001_foundation.sql`, `supabase/seed.sql`, `src/lib/database.types.ts` (generated)

**Interfaces:**
- Produces: tables `brands`, `brand_connections`, `brand_guidelines`, `media_assets`; enums `connection_provider`, `connection_status`, `guideline_kind`; storage bucket `media`; TS type `Database` exported from `src/lib/database.types.ts`.

- [ ] **Step 1: Initialise Supabase CLI and link the project**

```bash
npx supabase init
npx supabase login          # opens browser; user completes it
npx supabase link --project-ref dpihndeejbirskdrjfeh
```

If `login` needs to run interactively, ask the user to run `! npx supabase login` in the prompt.

- [ ] **Step 2: Write the migration**

`supabase/migrations/0001_foundation.sql`:

```sql
-- ===== Enums =====
create type connection_provider as enum ('wordpress','meta','pinterest','semrush');
create type connection_status   as enum ('not_connected','connected','failing');
create type guideline_kind      as enum ('social_style','social_post_spec','blog_style','blog_post_spec','pin_spec');

-- ===== updated_at trigger =====
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ===== Brands (clients) =====
create table brands (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  website_url text,
  timezone    text not null default 'America/Los_Angeles',
  seo_suffix  text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger brands_updated_at before update on brands for each row execute function set_updated_at();

-- ===== Brand connections =====
create table brand_connections (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  provider      connection_provider not null,
  config        jsonb not null default '{}'::jsonb,
  secret        text,
  status        connection_status not null default 'not_connected',
  last_checked  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (brand_id, provider)
);
create trigger brand_connections_updated_at before update on brand_connections for each row execute function set_updated_at();

-- ===== Brand guidelines =====
create table brand_guidelines (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references brands(id) on delete cascade,
  kind       guideline_kind not null,
  body_md    text not null default '',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (brand_id, kind)
);

-- ===== Media assets =====
create table media_assets (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  storage_path text not null,
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
create index media_assets_brand_created_idx on media_assets (brand_id, created_at desc);

-- ===== RLS: team-only app, any authenticated user has full access =====
alter table brands            enable row level security;
alter table brand_connections enable row level security;
alter table brand_guidelines  enable row level security;
alter table media_assets      enable row level security;

create policy "authenticated full access" on brands            for all to authenticated using (true) with check (true);
create policy "authenticated full access" on brand_connections for all to authenticated using (true) with check (true);
create policy "authenticated full access" on brand_guidelines  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on media_assets      for all to authenticated using (true) with check (true);

-- ===== Storage bucket for the media library =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 20971520, array['image/jpeg','image/png','image/webp','image/gif','image/avif'])
on conflict (id) do nothing;

create policy "public read media" on storage.objects for select using (bucket_id = 'media');
create policy "authenticated write media" on storage.objects for insert to authenticated with check (bucket_id = 'media');
create policy "authenticated update media" on storage.objects for update to authenticated using (bucket_id = 'media');
create policy "authenticated delete media" on storage.objects for delete to authenticated using (bucket_id = 'media');
```

- [ ] **Step 3: Write the seed**

`supabase/seed.sql`:

```sql
insert into brands (slug, name, website_url, timezone, seo_suffix)
values ('jamsam-digital', 'JamSam Digital', 'https://jamsamdigital.com', 'America/Los_Angeles', ' | JamSam Digital')
on conflict (slug) do nothing;
```

- [ ] **Step 4: Push the migration to the remote project**

```bash
npx supabase db push
```

Expected: "Applying migration 0001_foundation.sql... Finished". Then seed manually (db push does not run seed.sql against remote):

```bash
npx supabase db query --linked -f supabase/seed.sql
```

If `db query` is not available in the installed CLI version, paste `seed.sql` into the Supabase SQL editor.

- [ ] **Step 5: Verify tables exist**

```bash
npx supabase db query --linked "select table_name from information_schema.tables where table_schema='public' order by 1"
```

Expected: brand_connections, brand_guidelines, brands, media_assets.

- [ ] **Step 6: Generate TypeScript types**

```bash
npx supabase gen types typescript --linked > src/lib/database.types.ts
```

Add script to `package.json`: `"db:types": "supabase gen types typescript --linked > src/lib/database.types.ts"`.

- [ ] **Step 7: Wire the `Database` type into the clients**

In `src/lib/supabase/server.ts`, `client.ts`, and `admin.ts`, import `type { Database } from "@/lib/database.types"` and pass it as the generic: `createServerClient<Database>(...)`, `createBrowserClient<Database>(...)`, `createClient<Database>(...)`.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(db): foundation migration, seed, storage bucket, generated types"
```

---

### Task 4: Secret encryption helper

**Files:**
- Create: `src/lib/crypto.ts`, `src/lib/crypto.test.ts`

**Interfaces:**
- Produces: `encryptJson(value: unknown): string` and `decryptJson<T>(ciphertext: string): T`. Ciphertext format: base64 of `iv(12) || authTag(16) || data`.

- [ ] **Step 1: Write failing tests**

`src/lib/crypto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encryptJson, decryptJson } from "@/lib/crypto";

describe("crypto", () => {
  it("round-trips a JSON object", () => {
    const ct = encryptJson({ app_password: "abcd efgh" });
    expect(decryptJson<{ app_password: string }>(ct)).toEqual({ app_password: "abcd efgh" });
  });
  it("produces different ciphertext for the same input (random IV)", () => {
    expect(encryptJson({ a: 1 })).not.toBe(encryptJson({ a: 1 }));
  });
  it("throws on tampered ciphertext", () => {
    const ct = encryptJson({ a: 1 });
    const buf = Buffer.from(ct, "base64");
    buf[buf.length - 1] ^= 0xff;
    expect(() => decryptJson(buf.toString("base64"))).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/crypto.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/lib/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function key(): Buffer {
  return Buffer.from(env.CONNECTIONS_ENCRYPTION_KEY, "base64");
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64");
}

export function decryptJson<T = unknown>(ciphertext: string): T {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as T;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/crypto.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts src/lib/crypto.test.ts
git commit -m "feat: AES-256-GCM helper for connection secrets"
```

---

### Task 5: Login page and sign-out

**Files:**
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/login/login-form.tsx`, `src/app/(auth)/actions.ts`, `src/app/(auth)/layout.tsx`
- Modify: `src/app/page.tsx` (redirect to `/dashboard`), `src/app/layout.tsx` (metadata + Toaster)

**Interfaces:**
- Produces: server actions `signIn(formData)` and `signOut()`; route `/login`.

- [ ] **Step 1: Root layout with metadata and toaster**

Replace `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "JamSam Social", template: "%s | JamSam Social" },
  description: "Marketing operations for JamSam Digital clients",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
```

Replace `src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";
export default function Home() {
  redirect("/dashboard");
}
```

- [ ] **Step 2: Auth actions**

`src/app/(auth)/actions.ts`:

```ts
"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

const credentials = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
  next: z.string().optional(),
});

export async function signIn(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { ok: false, error: "Email or password is incorrect" };

  const next = parsed.data.next && parsed.data.next.startsWith("/") ? parsed.data.next : "/dashboard";
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 3: Login form (Client Component)**

`src/app/(auth)/login/login-form.tsx`:

```tsx
"use client";
import { useActionState } from "react";
import { signIn, type ActionResult } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(signIn, null);
  return (
    <form action={action} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Login page and auth layout**

`src/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">{children}</div>;
}
```

`src/app/(auth)/login/page.tsx`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">JamSam Social</CardTitle>
        <CardDescription>JamSam Digital team access only.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={next} />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Invite a user and verify manually**

In the Supabase dashboard: Authentication → Users → "Add user" → create the user with an email + password (or "Invite" and set a password via the emailed link). Also in Authentication → Providers → Email, turn **off** "Enable Sign ups" is not a per-provider toggle; instead set Authentication → Settings → "Allow new users to sign up" to **off**.

Run: `npm run dev`, open http://localhost:3000 → redirected to `/login`; sign in → redirected to `/dashboard` (404 for now, that's expected until Task 6).

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat(auth): login page and sign-out with Supabase Auth"
```

---

### Task 6: App shell (sidebar, header, brand switcher, current-brand cookie)

**Files:**
- Create: `src/lib/current-brand.ts`, `src/lib/brands/queries.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/dashboard/page.tsx` (placeholder, completed in Task 13), `src/components/shell/sidebar.tsx`, `src/components/shell/header.tsx`, `src/components/shell/brand-switcher.tsx`, `src/components/shell/sign-out-button.tsx`

**Interfaces:**
- Produces:
  - `listBrands({ includeArchived?: boolean }): Promise<Brand[]>` and `getBrandBySlug(slug): Promise<Brand | null>` where `Brand = Database["public"]["Tables"]["brands"]["Row"]`.
  - `getCurrentBrandSlug(): Promise<string | null>` (reads cookie `jamsam_brand`), server action `setCurrentBrand(slug: string)`.
  - `(app)` layout that renders sidebar + header around page content.

- [ ] **Step 1: Brand queries**

`src/lib/brands/queries.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type Brand = Database["public"]["Tables"]["brands"]["Row"];

export async function listBrands(opts: { includeArchived?: boolean } = {}): Promise<Brand[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from("brands").select("*").order("name");
  if (!opts.includeArchived) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

export async function getBrandBySlug(slug: string): Promise<Brand | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("brands").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
```

- [ ] **Step 2: Current-brand cookie helpers**

`src/lib/current-brand.ts`:

```ts
"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const COOKIE = "jamsam_brand";

export async function getCurrentBrandSlug(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}

export async function setCurrentBrand(slug: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, slug, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
```

- [ ] **Step 3: Shell components**

`src/components/shell/sidebar.tsx`:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/brands", label: "Brands" },
  { href: "/media", label: "Media" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/30">
      <div className="px-4 py-5">
        <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
          JamSam Social
        </Link>
        <p className="text-xs text-muted-foreground">JamSam Digital</p>
      </div>
      <nav className="flex flex-col gap-1 px-2">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted",
                active && "bg-muted text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

`src/components/shell/brand-switcher.tsx`:

```tsx
"use client";
import { useTransition } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setCurrentBrand } from "@/lib/current-brand";
import type { Brand } from "@/lib/brands/queries";

export function BrandSwitcher({ brands, current }: { brands: Brand[]; current: string | null }) {
  const [pending, start] = useTransition();
  if (brands.length === 0) return <span className="text-sm text-muted-foreground">No brands yet</span>;
  return (
    <Select value={current ?? undefined} onValueChange={(slug) => start(() => setCurrentBrand(slug))} disabled={pending}>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Select a brand" />
      </SelectTrigger>
      <SelectContent>
        {brands.map((b) => (
          <SelectItem key={b.id} value={b.slug}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

`src/components/shell/sign-out-button.tsx`:

```tsx
import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button variant="ghost" size="sm" type="submit">
        Sign out
      </Button>
    </form>
  );
}
```

`src/components/shell/header.tsx`:

```tsx
import { BrandSwitcher } from "./brand-switcher";
import { SignOutButton } from "./sign-out-button";
import type { Brand } from "@/lib/brands/queries";

export function Header({ brands, current, email }: { brands: Brand[]; current: string | null; email: string }) {
  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <BrandSwitcher brands={brands} current={current} />
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{email}</span>
        <SignOutButton />
      </div>
    </header>
  );
}
```

- [ ] **Step 4: App layout**

`src/app/(app)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { Sidebar } from "@/components/shell/sidebar";
import { Header } from "@/components/shell/header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [brands, current] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const currentValid = brands.some((b) => b.slug === current) ? current : (brands[0]?.slug ?? null);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Header brands={brands} current={currentValid} email={user.email ?? ""} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
```

Placeholder `src/app/(app)/dashboard/page.tsx` (replaced in Task 13):

```tsx
export default function DashboardPage() {
  return <h1 className="text-2xl font-semibold">Dashboard</h1>;
}
```

- [ ] **Step 5: Verify manually**

`npm run dev` → sign in → see sidebar, header with "JamSam Digital" seeded brand in the switcher, email, Sign out works.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat(shell): app layout with sidebar, header, brand switcher"
```

---

### Task 7: Brands CRUD (list, create, edit, archive)

**Files:**
- Create: `src/lib/brands/schema.ts`, `src/lib/brands/schema.test.ts`, `src/lib/brands/actions.ts`, `src/components/brands/brand-form.tsx`, `src/app/(app)/brands/page.tsx`, `src/app/(app)/brands/new/page.tsx`, `src/app/(app)/brands/[slug]/page.tsx`, `src/app/(app)/brands/[slug]/edit/page.tsx`, `src/app/(app)/brands/[slug]/brand-nav.tsx`

**Interfaces:**
- Consumes: `listBrands`, `getBrandBySlug`, `Brand` (Task 6).
- Produces:
  - `brandInputSchema` (zod) with `{ name, slug, website_url?, timezone, seo_suffix? }`, `slugify(name): string`.
  - Server actions `createBrand(prev, formData)`, `updateBrand(id, prev, formData)`, `setBrandActive(id, active)`; all return `ActionResult`.
  - Routes `/brands`, `/brands/new`, `/brands/[slug]`, `/brands/[slug]/edit`.

- [ ] **Step 1: Failing schema tests**

`src/lib/brands/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { brandInputSchema, slugify } from "@/lib/brands/schema";

describe("slugify", () => {
  it("lowercases, strips punctuation, hyphenates spaces", () => {
    expect(slugify("Acme Roofing & Siding, Inc.")).toBe("acme-roofing-siding-inc");
  });
  it("collapses repeated hyphens and trims", () => {
    expect(slugify("  --Big   Sky--  ")).toBe("big-sky");
  });
});

describe("brandInputSchema", () => {
  it("accepts a valid brand and normalises empty optional strings to null", () => {
    const r = brandInputSchema.parse({ name: "Acme", slug: "acme", website_url: "", timezone: "America/Denver", seo_suffix: "" });
    expect(r.website_url).toBeNull();
    expect(r.seo_suffix).toBeNull();
  });
  it("rejects a slug with uppercase or spaces", () => {
    expect(() => brandInputSchema.parse({ name: "A", slug: "Bad Slug", timezone: "UTC" })).toThrow();
  });
  it("rejects an invalid website URL", () => {
    expect(() => brandInputSchema.parse({ name: "A", slug: "a", website_url: "not a url", timezone: "UTC" })).toThrow();
  });
  it("rejects an unknown timezone", () => {
    expect(() => brandInputSchema.parse({ name: "A", slug: "a", timezone: "Mars/Olympus" })).toThrow(/timezone/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/brands/schema.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement schema**

`src/lib/brands/schema.ts`:

```ts
import { z } from "zod";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const brandInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug may only contain lowercase letters, numbers, and hyphens"),
  website_url: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null)
    .refine((v) => v === null || z.string().url().safeParse(v).success, "Enter a valid URL"),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
  seo_suffix: optionalText,
});

export type BrandInput = z.infer<typeof brandInputSchema>;
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/brands/schema.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Server actions**

`src/lib/brands/actions.ts`:

```ts
"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { brandInputSchema } from "./schema";

export type ActionResult = { ok: true } | { ok: false; error: string };

function firstIssue(e: { issues: { message: string }[] }) {
  return e.issues[0]?.message ?? "Invalid input";
}

export async function createBrand(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = brandInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("brands").insert(parsed.data);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That slug is already in use" };
    return { ok: false, error: error.message };
  }
  revalidatePath("/brands");
  redirect(`/brands/${parsed.data.slug}`);
}

export async function updateBrand(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = brandInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("brands").update(parsed.data).eq("id", id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That slug is already in use" };
    return { ok: false, error: error.message };
  }
  revalidatePath("/brands");
  redirect(`/brands/${parsed.data.slug}`);
}

export async function setBrandActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("brands").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/brands");
  revalidatePath("/dashboard");
  return { ok: true };
}
```

- [ ] **Step 6: Brand form component**

`src/components/brands/brand-form.tsx`:

```tsx
"use client";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/brands/schema";
import type { ActionResult } from "@/lib/brands/actions";
import type { Brand } from "@/lib/brands/queries";

type Props = {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  brand?: Brand;
  submitLabel: string;
};

export function BrandForm({ action, brand, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const [slug, setSlug] = useState(brand?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(brand));

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Client name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={brand?.name}
          required
          onChange={(e) => {
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          name="slug"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
        />
        <p className="text-xs text-muted-foreground">Used in URLs and by the AI tools. Lowercase, hyphens only.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="website_url">Website URL</Label>
        <Input id="website_url" name="website_url" type="url" placeholder="https://" defaultValue={brand?.website_url ?? ""} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="timezone">Timezone</Label>
        <Input id="timezone" name="timezone" defaultValue={brand?.timezone ?? "America/Los_Angeles"} required />
        <p className="text-xs text-muted-foreground">IANA name, e.g. America/Los_Angeles, America/Denver.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="seo_suffix">SEO title suffix</Label>
        <Input id="seo_suffix" name="seo_suffix" placeholder=" | Client Name" defaultValue={brand?.seo_suffix ?? ""} />
      </div>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
```

- [ ] **Step 7: Pages**

`src/app/(app)/brands/page.tsx`:

```tsx
import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Brands" };

export default async function BrandsPage() {
  const brands = await listBrands({ includeArchived: true });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Brands</h1>
        <Button asChild>
          <Link href="/brands/new">New brand</Link>
        </Button>
      </div>
      {brands.length === 0 ? (
        <p className="text-muted-foreground">No brands yet. Create your first client.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => (
            <Link key={b.id} href={`/brands/${b.slug}`}>
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardContent className="space-y-1 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{b.name}</span>
                    {!b.active && <Badge variant="secondary">Archived</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{b.website_url ?? "No website"}</p>
                  <p className="text-xs text-muted-foreground">{b.timezone}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

`src/app/(app)/brands/new/page.tsx`:

```tsx
import { BrandForm } from "@/components/brands/brand-form";
import { createBrand } from "@/lib/brands/actions";

export const metadata = { title: "New brand" };

export default function NewBrandPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New brand</h1>
      <BrandForm action={createBrand} submitLabel="Create brand" />
    </div>
  );
}
```

`src/app/(app)/brands/[slug]/brand-nav.tsx`:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function BrandNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/brands/${slug}`, label: "Overview" },
    { href: `/brands/${slug}/connections`, label: "Connections" },
    { href: `/brands/${slug}/guidelines`, label: "Guidelines" },
  ];
  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
            pathname === t.href && "border-foreground text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
```

`src/app/(app)/brands/[slug]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands/queries";
import { setBrandActive } from "@/lib/brands/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandNav } from "./brand-nav";

export default async function BrandOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();

  const toggle = setBrandActive.bind(null, brand.id, !brand.active);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{brand.name}</h1>
          {!brand.active && <Badge variant="secondary">Archived</Badge>}
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/brands/${brand.slug}/edit`}>Edit</Link>
          </Button>
          <form action={toggle}>
            <Button variant={brand.active ? "destructive" : "default"} type="submit">
              {brand.active ? "Archive" : "Restore"}
            </Button>
          </form>
        </div>
      </div>
      <BrandNav slug={brand.slug} />
      <dl className="grid max-w-lg grid-cols-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Slug</dt>
        <dd className="col-span-2 font-mono">{brand.slug}</dd>
        <dt className="text-muted-foreground">Website</dt>
        <dd className="col-span-2">{brand.website_url ?? "Not set"}</dd>
        <dt className="text-muted-foreground">Timezone</dt>
        <dd className="col-span-2">{brand.timezone}</dd>
        <dt className="text-muted-foreground">SEO suffix</dt>
        <dd className="col-span-2">{brand.seo_suffix ?? "Not set"}</dd>
      </dl>
    </div>
  );
}
```

`src/app/(app)/brands/[slug]/edit/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands/queries";
import { updateBrand } from "@/lib/brands/actions";
import { BrandForm } from "@/components/brands/brand-form";

export default async function EditBrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const action = updateBrand.bind(null, brand.id);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Edit {brand.name}</h1>
      <BrandForm action={action} brand={brand} submitLabel="Save changes" />
    </div>
  );
}
```

Note: `setBrandActive` returns `ActionResult` but is used as a plain `<form action>`. That is allowed; Next ignores the return value. The Archive/Restore buttons re-render via `revalidatePath`.

- [ ] **Step 8: Verify manually**

`npm run dev`: create a brand "Acme Roofing" → lands on `/brands/acme-roofing`; edit it; archive; restore; duplicate slug shows "That slug is already in use".

- [ ] **Step 9: Typecheck, lint, test, commit**

```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat(brands): list, create, edit, archive brands"
```

---

### Task 8: Connection provider modules (WordPress, Meta, Pinterest, SEMrush)

**Files:**
- Create: `src/lib/connections/types.ts`, `src/lib/connections/http.ts`, `src/lib/connections/http.test.ts`, `src/lib/connections/wordpress.ts`, `src/lib/connections/wordpress.test.ts`, `src/lib/connections/meta.ts`, `src/lib/connections/meta.test.ts`, `src/lib/connections/pinterest.ts`, `src/lib/connections/pinterest.test.ts`, `src/lib/connections/semrush.ts`, `src/lib/connections/semrush.test.ts`, `src/lib/connections/index.ts`

**Interfaces:**
- Produces:

```ts
export type Provider = "wordpress" | "meta" | "pinterest" | "semrush";
export type TestResult = { ok: true; detail: string } | { ok: false; error: string };

export type WordpressConfig = { site_url: string; username: string };
export type WordpressSecret = { app_password: string };
export type MetaConfig = { page_id: string; page_name?: string; ig_user_id?: string; ig_username?: string };
export type MetaSecret = { page_access_token: string; expires_at?: string };
export type PinterestConfig = { username?: string; ad_account_id?: string };
export type PinterestSecret = { access_token: string; refresh_token?: string; expires_at?: string };
export type SemrushConfig = { database: string };
export type SemrushSecret = { api_key: string };

export interface ConnectionProvider<C, S> {
  provider: Provider;
  configSchema: z.ZodType<C>;
  secretSchema: z.ZodType<S>;
  test(config: C, secret: S, fetchImpl?: typeof fetch): Promise<TestResult>;
}
```

  - `fetchWithTimeout(input, init, ms = 10_000, fetchImpl = fetch)` in `http.ts`.
  - `PROVIDERS: Record<Provider, ConnectionProvider<any, any>>` from `index.ts`.

- [ ] **Step 1: Types**

`src/lib/connections/types.ts`:

```ts
import type { z } from "zod";

export type Provider = "wordpress" | "meta" | "pinterest" | "semrush";
export const PROVIDER_LABELS: Record<Provider, string> = {
  wordpress: "WordPress",
  meta: "Meta (Facebook + Instagram)",
  pinterest: "Pinterest",
  semrush: "SEMrush",
};

export type TestResult = { ok: true; detail: string } | { ok: false; error: string };

export interface ConnectionProvider<C, S> {
  provider: Provider;
  configSchema: z.ZodType<C>;
  secretSchema: z.ZodType<S>;
  test(config: C, secret: S, fetchImpl?: typeof fetch): Promise<TestResult>;
}
```

- [ ] **Step 2: Failing test for the timeout helper**

`src/lib/connections/http.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchWithTimeout } from "@/lib/connections/http";

describe("fetchWithTimeout", () => {
  it("passes through a fast response", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    const res = await fetchWithTimeout("https://x", {}, 1000, f as unknown as typeof fetch);
    expect(res.status).toBe(200);
  });
  it("rejects with a timeout message when the request hangs", async () => {
    const f = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    await expect(fetchWithTimeout("https://x", {}, 20, f as unknown as typeof fetch)).rejects.toThrow(/timed out/i);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/connections/http.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement helper**

`src/lib/connections/http.ts`:

```ts
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  ms = 10_000,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") throw new Error(`Request timed out after ${ms / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Normalise any thrown value into a TestResult error string. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
```

- [ ] **Step 5: Run helper tests**

Run: `npx vitest run src/lib/connections/http.test.ts`
Expected: 2 passed.

- [ ] **Step 6: WordPress: failing tests**

`src/lib/connections/wordpress.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { wordpress } from "@/lib/connections/wordpress";

const cfg = { site_url: "https://client.com/", username: "jamie" };
const sec = { app_password: "abcd efgh ijkl" };

describe("wordpress.test", () => {
  it("succeeds and reports the user name and role", async () => {
    const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://client.com/wp-json/wp/v2/users/me?context=edit");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Basic " + Buffer.from("jamie:abcd efgh ijkl").toString("base64"),
      );
      return new Response(JSON.stringify({ name: "Jamie", roles: ["administrator"] }), { status: 200 });
    });
    const r = await wordpress.test(cfg, sec, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, detail: "Signed in as Jamie (administrator)" });
  });
  it("fails with a readable message on 401", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ message: "Sorry, you are not allowed" }), { status: 401 }));
    const r = await wordpress.test(cfg, sec, f as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/401/);
  });
  it("fails when fetch throws", async () => {
    const f = vi.fn(async () => {
      throw new Error("Request timed out after 10s");
    });
    const r = await wordpress.test(cfg, sec, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, error: "Request timed out after 10s" });
  });
});
```

- [ ] **Step 7: WordPress: implement**

`src/lib/connections/wordpress.ts`:

```ts
import { z } from "zod";
import type { ConnectionProvider, TestResult } from "./types";
import { fetchWithTimeout, errorMessage } from "./http";

export const wordpressConfigSchema = z.object({
  site_url: z.string().url("Enter the site URL, e.g. https://client.com"),
  username: z.string().min(1, "Username is required"),
});
export const wordpressSecretSchema = z.object({
  app_password: z.string().min(1, "Application password is required"),
});
export type WordpressConfig = z.infer<typeof wordpressConfigSchema>;
export type WordpressSecret = z.infer<typeof wordpressSecretSchema>;

export function wpBase(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

export function wpAuthHeader(username: string, appPassword: string): string {
  return "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");
}

export const wordpress: ConnectionProvider<WordpressConfig, WordpressSecret> = {
  provider: "wordpress",
  configSchema: wordpressConfigSchema,
  secretSchema: wordpressSecretSchema,
  async test(config, secret, fetchImpl = fetch): Promise<TestResult> {
    try {
      const res = await fetchWithTimeout(
        `${wpBase(config.site_url)}/wp-json/wp/v2/users/me?context=edit`,
        { headers: { Authorization: wpAuthHeader(config.username, secret.app_password), Accept: "application/json" } },
        10_000,
        fetchImpl,
      );
      if (!res.ok) {
        let msg = "";
        try {
          msg = ((await res.json()) as { message?: string }).message ?? "";
        } catch {}
        return { ok: false, error: `WordPress responded ${res.status}${msg ? `: ${msg}` : ""}` };
      }
      const me = (await res.json()) as { name?: string; roles?: string[] };
      return { ok: true, detail: `Signed in as ${me.name ?? config.username} (${(me.roles ?? []).join(", ") || "unknown role"})` };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },
};
```

- [ ] **Step 8: Run WordPress tests**

Run: `npx vitest run src/lib/connections/wordpress.test.ts`
Expected: 3 passed.

- [ ] **Step 9: Meta: failing tests**

`src/lib/connections/meta.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { meta } from "@/lib/connections/meta";

const cfg = { page_id: "123" };
const sec = { page_access_token: "EAAB..." };

describe("meta.test", () => {
  it("succeeds and reports page + instagram account", async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      expect(u.origin + u.pathname).toBe("https://graph.facebook.com/v21.0/123");
      expect(u.searchParams.get("access_token")).toBe("EAAB...");
      return new Response(
        JSON.stringify({ name: "Acme Page", instagram_business_account: { id: "999", username: "acme" } }),
        { status: 200 },
      );
    });
    const r = await meta.test(cfg, sec, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, detail: "Page: Acme Page. Instagram: @acme" });
  });
  it("reports missing instagram without failing", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ name: "Acme Page" }), { status: 200 }));
    const r = await meta.test(cfg, sec, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, detail: "Page: Acme Page. Instagram: not linked" });
  });
  it("surfaces Graph API error messages", async () => {
    const f = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 400 }),
    );
    const r = await meta.test(cfg, sec, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, error: "Meta responded 400: Invalid OAuth access token" });
  });
});
```

- [ ] **Step 10: Meta: implement**

`src/lib/connections/meta.ts`:

```ts
import { z } from "zod";
import type { ConnectionProvider, TestResult } from "./types";
import { fetchWithTimeout, errorMessage } from "./http";

export const META_GRAPH = "https://graph.facebook.com/v21.0";

export const metaConfigSchema = z.object({
  page_id: z.string().min(1, "Facebook Page ID is required"),
  page_name: z.string().optional(),
  ig_user_id: z.string().optional(),
  ig_username: z.string().optional(),
});
export const metaSecretSchema = z.object({
  page_access_token: z.string().min(1, "Page access token is required"),
  expires_at: z.string().optional(),
});
export type MetaConfig = z.infer<typeof metaConfigSchema>;
export type MetaSecret = z.infer<typeof metaSecretSchema>;

export const meta: ConnectionProvider<MetaConfig, MetaSecret> = {
  provider: "meta",
  configSchema: metaConfigSchema,
  secretSchema: metaSecretSchema,
  async test(config, secret, fetchImpl = fetch): Promise<TestResult> {
    try {
      const url = new URL(`${META_GRAPH}/${config.page_id}`);
      url.searchParams.set("fields", "name,instagram_business_account{id,username}");
      url.searchParams.set("access_token", secret.page_access_token);
      const res = await fetchWithTimeout(url, {}, 10_000, fetchImpl);
      const body = (await res.json()) as {
        name?: string;
        instagram_business_account?: { id: string; username?: string };
        error?: { message?: string };
      };
      if (!res.ok) return { ok: false, error: `Meta responded ${res.status}: ${body.error?.message ?? "unknown error"}` };
      const ig = body.instagram_business_account;
      return { ok: true, detail: `Page: ${body.name ?? config.page_id}. Instagram: ${ig?.username ? `@${ig.username}` : "not linked"}` };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },
};

/** After a successful test, copy the discovered names/ids back into config so the UI can show them. */
export async function enrichMetaConfig(config: MetaConfig, secret: MetaSecret, fetchImpl: typeof fetch = fetch): Promise<MetaConfig> {
  const url = new URL(`${META_GRAPH}/${config.page_id}`);
  url.searchParams.set("fields", "name,instagram_business_account{id,username}");
  url.searchParams.set("access_token", secret.page_access_token);
  const res = await fetchWithTimeout(url, {}, 10_000, fetchImpl);
  if (!res.ok) return config;
  const body = (await res.json()) as { name?: string; instagram_business_account?: { id: string; username?: string } };
  return {
    ...config,
    page_name: body.name ?? config.page_name,
    ig_user_id: body.instagram_business_account?.id ?? config.ig_user_id,
    ig_username: body.instagram_business_account?.username ?? config.ig_username,
  };
}
```

- [ ] **Step 11: Run Meta tests**

Run: `npx vitest run src/lib/connections/meta.test.ts`
Expected: 3 passed.

- [ ] **Step 12: Pinterest: failing tests**

`src/lib/connections/pinterest.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { pinterest } from "@/lib/connections/pinterest";

describe("pinterest.test", () => {
  it("succeeds with the account username", async () => {
    const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.pinterest.com/v5/user_account");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return new Response(JSON.stringify({ username: "acmebuilds", account_type: "BUSINESS" }), { status: 200 });
    });
    const r = await pinterest.test({}, { access_token: "tok" }, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, detail: "Connected as @acmebuilds (BUSINESS)" });
  });
  it("fails on 401", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ message: "Authentication failed." }), { status: 401 }));
    const r = await pinterest.test({}, { access_token: "bad" }, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, error: "Pinterest responded 401: Authentication failed." });
  });
});
```

- [ ] **Step 13: Pinterest: implement**

`src/lib/connections/pinterest.ts`:

```ts
import { z } from "zod";
import type { ConnectionProvider, TestResult } from "./types";
import { fetchWithTimeout, errorMessage } from "./http";

export const PINTEREST_API = "https://api.pinterest.com/v5";

export const pinterestConfigSchema = z.object({
  username: z.string().optional(),
  ad_account_id: z.string().optional(),
});
export const pinterestSecretSchema = z.object({
  access_token: z.string().min(1, "Access token is required"),
  refresh_token: z.string().optional(),
  expires_at: z.string().optional(),
});
export type PinterestConfig = z.infer<typeof pinterestConfigSchema>;
export type PinterestSecret = z.infer<typeof pinterestSecretSchema>;

export const pinterest: ConnectionProvider<PinterestConfig, PinterestSecret> = {
  provider: "pinterest",
  configSchema: pinterestConfigSchema,
  secretSchema: pinterestSecretSchema,
  async test(_config, secret, fetchImpl = fetch): Promise<TestResult> {
    try {
      const res = await fetchWithTimeout(
        `${PINTEREST_API}/user_account`,
        { headers: { Authorization: `Bearer ${secret.access_token}`, Accept: "application/json" } },
        10_000,
        fetchImpl,
      );
      const body = (await res.json()) as { username?: string; account_type?: string; message?: string };
      if (!res.ok) return { ok: false, error: `Pinterest responded ${res.status}: ${body.message ?? "unknown error"}` };
      return { ok: true, detail: `Connected as @${body.username ?? "unknown"} (${body.account_type ?? "unknown type"})` };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },
};
```

- [ ] **Step 14: Run Pinterest tests**

Run: `npx vitest run src/lib/connections/pinterest.test.ts`
Expected: 2 passed.

- [ ] **Step 15: SEMrush: failing tests**

`src/lib/connections/semrush.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { semrush } from "@/lib/connections/semrush";

describe("semrush.test", () => {
  it("succeeds and reports remaining API units", async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("https://www.semrush.com/users/countapiunits.html?key=k1");
      return new Response("48210", { status: 200 });
    });
    const r = await semrush.test({ database: "us" }, { api_key: "k1" }, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, detail: "48,210 API units remaining" });
  });
  it("fails when SEMrush returns an error string", async () => {
    const f = vi.fn(async () => new Response("ERROR 120 :: WRONG KEY - ID PAIR", { status: 200 }));
    const r = await semrush.test({ database: "us" }, { api_key: "bad" }, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, error: "SEMrush: ERROR 120 :: WRONG KEY - ID PAIR" });
  });
});
```

- [ ] **Step 16: SEMrush: implement**

`src/lib/connections/semrush.ts`:

```ts
import { z } from "zod";
import type { ConnectionProvider, TestResult } from "./types";
import { fetchWithTimeout, errorMessage } from "./http";

export const semrushConfigSchema = z.object({
  database: z.string().min(2).default("us"),
});
export const semrushSecretSchema = z.object({
  api_key: z.string().min(1, "API key is required"),
});
export type SemrushConfig = z.infer<typeof semrushConfigSchema>;
export type SemrushSecret = z.infer<typeof semrushSecretSchema>;

export const semrush: ConnectionProvider<SemrushConfig, SemrushSecret> = {
  provider: "semrush",
  configSchema: semrushConfigSchema,
  secretSchema: semrushSecretSchema,
  async test(_config, secret, fetchImpl = fetch): Promise<TestResult> {
    try {
      // countapiunits is free: it does not consume units and validates the key.
      const res = await fetchWithTimeout(
        `https://www.semrush.com/users/countapiunits.html?key=${encodeURIComponent(secret.api_key)}`,
        {},
        10_000,
        fetchImpl,
      );
      const text = (await res.text()).trim();
      if (!res.ok) return { ok: false, error: `SEMrush responded ${res.status}` };
      if (text.startsWith("ERROR")) return { ok: false, error: `SEMrush: ${text}` };
      const units = Number(text);
      if (!Number.isFinite(units)) return { ok: false, error: `SEMrush returned an unexpected response: ${text.slice(0, 80)}` };
      return { ok: true, detail: `${units.toLocaleString("en-US")} API units remaining` };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },
};
```

- [ ] **Step 17: Run SEMrush tests**

Run: `npx vitest run src/lib/connections/semrush.test.ts`
Expected: 2 passed.

- [ ] **Step 18: Registry**

`src/lib/connections/index.ts`:

```ts
import type { Provider, ConnectionProvider } from "./types";
import { wordpress } from "./wordpress";
import { meta } from "./meta";
import { pinterest } from "./pinterest";
import { semrush } from "./semrush";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PROVIDERS: Record<Provider, ConnectionProvider<any, any>> = { wordpress, meta, pinterest, semrush };
export const PROVIDER_ORDER: Provider[] = ["wordpress", "meta", "pinterest", "semrush"];

export * from "./types";
```

- [ ] **Step 19: Run all tests, commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/lib/connections
git commit -m "feat(connections): provider modules with real test() calls for WordPress, Meta, Pinterest, SEMrush"
```

---

### Task 9: Connections settings UI and save-and-test action

**Files:**
- Create: `src/lib/connections/queries.ts`, `src/lib/connections/actions.ts`, `src/components/brands/connection-card.tsx`, `src/components/brands/connection-forms.tsx`, `src/app/(app)/brands/[slug]/connections/page.tsx`, `src/app/api/connections/[id]/test/route.ts`

**Interfaces:**
- Consumes: `PROVIDERS`, `PROVIDER_ORDER`, `PROVIDER_LABELS`, provider schemas (Task 8); `encryptJson`/`decryptJson` (Task 4); `getBrandBySlug` (Task 6); `createAdminSupabase` (Task 2).
- Produces:
  - `listConnectionsForBrand(brandId): Promise<ConnectionPublic[]>` where `ConnectionPublic = Omit<Row, "secret"> & { has_secret: boolean }` (never includes the ciphertext).
  - `getConnectionWithSecret(brandId, provider): Promise<{ config: C; secret: S } | null>` (admin client, server only) for later phases.
  - Server action `saveAndTestConnection(brandId, provider, prev, formData): Promise<ActionResult>`.
  - `POST /api/connections/[id]/test` re-runs the test for an existing row (used by the "Test" button).

- [ ] **Step 1: Queries**

`src/lib/connections/queries.ts`:

```ts
import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { decryptJson } from "@/lib/crypto";
import type { Database } from "@/lib/database.types";
import type { Provider } from "./types";

type Row = Database["public"]["Tables"]["brand_connections"]["Row"];
export type ConnectionPublic = Omit<Row, "secret"> & { has_secret: boolean };

const PUBLIC_COLUMNS = "id,brand_id,provider,config,status,last_checked,last_error,created_at,updated_at,secret" as const;

export async function listConnectionsForBrand(brandId: string): Promise<ConnectionPublic[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("brand_connections").select(PUBLIC_COLUMNS).eq("brand_id", brandId);
  if (error) throw new Error(error.message);
  // Strip the ciphertext before it can reach any component.
  return data.map(({ secret, ...rest }) => ({ ...rest, has_secret: Boolean(secret) }));
}

/** Server-only. Returns decrypted credentials for use by publishers/pushers. */
export async function getConnectionWithSecret<C = Record<string, unknown>, S = Record<string, unknown>>(
  brandId: string,
  provider: Provider,
): Promise<{ id: string; config: C; secret: S } | null> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("brand_connections")
    .select("id,config,secret")
    .eq("brand_id", brandId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.secret) return null;
  return { id: data.id, config: data.config as C, secret: decryptJson<S>(data.secret) };
}
```

- [ ] **Step 2: Save-and-test action + shared runner**

`src/lib/connections/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { encryptJson, decryptJson } from "@/lib/crypto";
import { PROVIDERS, type Provider, type TestResult } from "./index";
import { enrichMetaConfig, type MetaConfig, type MetaSecret } from "./meta";

export type ActionResult = { ok: true; detail: string } | { ok: false; error: string };

async function requireUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user;
}

/** Runs provider.test and writes status/last_error back to the row. */
export async function runConnectionTest(connectionId: string): Promise<TestResult> {
  const admin = createAdminSupabase();
  const { data: row, error } = await admin
    .from("brand_connections")
    .select("id,brand_id,provider,config,secret")
    .eq("id", connectionId)
    .single();
  if (error || !row) return { ok: false, error: "Connection not found" };
  if (!row.secret) return { ok: false, error: "No credentials saved yet" };

  const provider = PROVIDERS[row.provider as Provider];
  const secret = decryptJson(row.secret);
  const result = await provider.test(row.config, secret);

  let config = row.config;
  if (result.ok && row.provider === "meta") {
    config = await enrichMetaConfig(row.config as MetaConfig, secret as MetaSecret);
  }

  await admin
    .from("brand_connections")
    .update({
      config,
      status: result.ok ? "connected" : "failing",
      last_checked: new Date().toISOString(),
      last_error: result.ok ? null : result.error,
    })
    .eq("id", row.id);

  return result;
}

export async function saveAndTestConnection(
  brandId: string,
  provider: Provider,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireUser();
  } catch {
    return { ok: false, error: "Not signed in" };
  }

  const def = PROVIDERS[provider];
  const raw = Object.fromEntries(formData) as Record<string, string>;

  const config = def.configSchema.safeParse(raw);
  if (!config.success) return { ok: false, error: config.error.issues[0]?.message ?? "Invalid settings" };

  // Secret fields are optional on re-save: blank means "keep the existing secret".
  const admin = createAdminSupabase();
  const { data: existing } = await admin
    .from("brand_connections")
    .select("id,secret")
    .eq("brand_id", brandId)
    .eq("provider", provider)
    .maybeSingle();

  const secretFieldsProvided = Object.keys(def.secretSchema.shape as Record<string, unknown>).some((k) => raw[k]?.trim());
  let secretCipher: string | null = existing?.secret ?? null;
  if (secretFieldsProvided) {
    const secret = def.secretSchema.safeParse(raw);
    if (!secret.success) return { ok: false, error: secret.error.issues[0]?.message ?? "Invalid credentials" };
    secretCipher = encryptJson(secret.data);
  }
  if (!secretCipher) return { ok: false, error: "Credentials are required" };

  const { data: saved, error } = await admin
    .from("brand_connections")
    .upsert(
      { brand_id: brandId, provider, config: config.data, secret: secretCipher, status: "not_connected" },
      { onConflict: "brand_id,provider" },
    )
    .select("id")
    .single();
  if (error || !saved) return { ok: false, error: error?.message ?? "Could not save connection" };

  const result = await runConnectionTest(saved.id);
  revalidatePath(`/brands`, "layout");
  revalidatePath("/dashboard");
  return result;
}
```

Note on `def.secretSchema.shape`: every provider's `secretSchema` is a `z.object`, so `.shape` exists at runtime; the `ConnectionProvider` type uses `z.ZodType` so cast: `(def.secretSchema as z.ZodObject<z.ZodRawShape>).shape`. Add `import type { z } from "zod";` and use that cast.

- [ ] **Step 3: Test route (re-test an existing connection)**

`src/app/api/connections/[id]/test/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { runConnectionTest } from "@/lib/connections/actions";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const result = await runConnectionTest(id);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
```

- [ ] **Step 4: Per-provider form fields**

`src/components/brands/connection-forms.tsx`:

```tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Provider } from "@/lib/connections/types";

type Field = { name: string; label: string; secret?: boolean; placeholder?: string; help?: string; type?: string };

export const FIELDS: Record<Provider, Field[]> = {
  wordpress: [
    { name: "site_url", label: "Site URL", placeholder: "https://client.com", type: "url" },
    { name: "username", label: "WordPress username" },
    {
      name: "app_password",
      label: "Application password",
      secret: true,
      help: "WP Admin → Users → Profile → Application Passwords. Leave blank to keep the saved one.",
    },
  ],
  meta: [
    { name: "page_id", label: "Facebook Page ID" },
    {
      name: "page_access_token",
      label: "Page access token (long-lived)",
      secret: true,
      help: "From Graph API Explorer with pages_manage_posts, pages_read_engagement, instagram_basic, instagram_content_publish. Leave blank to keep the saved one.",
    },
  ],
  pinterest: [
    {
      name: "access_token",
      label: "Access token",
      secret: true,
      help: "From your Pinterest developer app with boards:read, pins:read, pins:write. Leave blank to keep the saved one.",
    },
    { name: "refresh_token", label: "Refresh token (optional)", secret: true },
  ],
  semrush: [
    { name: "database", label: "Database", placeholder: "us" },
    { name: "api_key", label: "API key", secret: true, help: "Leave blank to keep the saved one." },
  ],
};

export function ConnectionFields({ provider, config }: { provider: Provider; config: Record<string, unknown> }) {
  return (
    <div className="space-y-3">
      {FIELDS[provider].map((f) => (
        <div key={f.name} className="space-y-1">
          <Label htmlFor={`${provider}-${f.name}`}>{f.label}</Label>
          <Input
            id={`${provider}-${f.name}`}
            name={f.name}
            type={f.secret ? "password" : (f.type ?? "text")}
            placeholder={f.placeholder}
            defaultValue={f.secret ? "" : String(config[f.name] ?? "")}
            autoComplete="off"
          />
          {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Connection card (Client Component)**

`src/components/brands/connection-card.tsx`:

```tsx
"use client";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConnectionFields } from "./connection-forms";
import { saveAndTestConnection, type ActionResult } from "@/lib/connections/actions";
import { PROVIDER_LABELS, type Provider } from "@/lib/connections/types";
import type { ConnectionPublic } from "@/lib/connections/queries";

export function StatusBadge({ status }: { status: ConnectionPublic["status"] | "missing" }) {
  if (status === "connected") return <Badge className="bg-green-600 hover:bg-green-600">Connected</Badge>;
  if (status === "failing") return <Badge variant="destructive">Failing</Badge>;
  return <Badge variant="secondary">Not connected</Badge>;
}

export function ConnectionCard({
  brandId,
  provider,
  connection,
}: {
  brandId: string;
  provider: Provider;
  connection: ConnectionPublic | null;
}) {
  const action = saveAndTestConnection.bind(null, brandId, provider);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const [retesting, startRetest] = useTransition();
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);

  const status = connection?.status ?? "missing";
  const shown = lastResult ?? state;

  function retest() {
    if (!connection) return;
    startRetest(async () => {
      const res = await fetch(`/api/connections/${connection.id}/test`, { method: "POST" });
      const body = (await res.json()) as ActionResult;
      setLastResult(body);
      if (body.ok) toast.success(body.detail);
      else toast.error(body.error);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{PROVIDER_LABELS[provider]}</CardTitle>
        <StatusBadge status={status} />
      </CardHeader>
      <CardContent className="space-y-4">
        {connection?.provider === "meta" && connection.config && (connection.config as { page_name?: string }).page_name && (
          <p className="text-sm text-muted-foreground">
            Page: {(connection.config as { page_name?: string }).page_name}
            {(connection.config as { ig_username?: string }).ig_username
              ? ` · Instagram @${(connection.config as { ig_username?: string }).ig_username}`
              : " · Instagram not linked"}
          </p>
        )}
        <form action={formAction} className="space-y-4">
          <ConnectionFields provider={provider} config={(connection?.config as Record<string, unknown>) ?? {}} />
          {shown && (
            <p className={shown.ok ? "text-sm text-green-700" : "text-sm text-destructive"}>
              {shown.ok ? shown.detail : shown.error}
            </p>
          )}
          {!shown && connection?.last_error && <p className="text-sm text-destructive">{connection.last_error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Testing..." : "Save & test"}
            </Button>
            {connection?.has_secret && (
              <Button type="button" variant="outline" onClick={retest} disabled={retesting}>
                {retesting ? "Testing..." : "Test"}
              </Button>
            )}
          </div>
          {connection?.last_checked && (
            <p className="text-xs text-muted-foreground">Last checked {new Date(connection.last_checked).toLocaleString()}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Connections page**

`src/app/(app)/brands/[slug]/connections/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands/queries";
import { listConnectionsForBrand } from "@/lib/connections/queries";
import { PROVIDER_ORDER } from "@/lib/connections";
import { ConnectionCard } from "@/components/brands/connection-card";
import { BrandNav } from "../brand-nav";

export const metadata = { title: "Connections" };

export default async function ConnectionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const connections = await listConnectionsForBrand(brand.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{brand.name}</h1>
      <BrandNav slug={brand.slug} />
      <div className="grid gap-4 lg:grid-cols-2">
        {PROVIDER_ORDER.map((p) => (
          <ConnectionCard key={p} brandId={brand.id} provider={p} connection={connections.find((c) => c.provider === p) ?? null} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify against a real client**

`npm run dev` → `/brands/<slug>/connections`. Enter a real WordPress site URL + username + application password → "Signed in as ... (administrator)" and a green badge. Enter a wrong password → red "Failing" with `WordPress responded 401: ...`. Repeat for Meta with a real Page ID + token. Reload the page: the password field is empty (never echoed), badge persists, "Test" re-runs.

Confirm in the browser devtools Network tab that no response body contains the ciphertext or the raw password.

- [ ] **Step 8: Typecheck, lint, test, commit**

```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat(connections): per-brand settings with encrypted secrets and save-and-test"
```

---

### Task 10: Brand guideline documents

**Files:**
- Create: `src/lib/guidelines/queries.ts`, `src/lib/guidelines/actions.ts`, `src/lib/guidelines/kinds.ts`, `src/lib/guidelines/kinds.test.ts`, `src/components/brands/guideline-editor.tsx`, `src/app/(app)/brands/[slug]/guidelines/page.tsx`

**Interfaces:**
- Produces:
  - `GUIDELINE_KINDS: { kind: GuidelineKind; label: string; description: string }[]` and `isGuidelineKind(v): v is GuidelineKind`.
  - `getGuidelines(brandId): Promise<Record<GuidelineKind, string>>` (missing kinds → `""`).
  - Server action `saveGuideline(brandId, kind, prev, formData): Promise<ActionResult>`.

- [ ] **Step 1: Failing kinds test**

`src/lib/guidelines/kinds.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GUIDELINE_KINDS, isGuidelineKind } from "@/lib/guidelines/kinds";

describe("guideline kinds", () => {
  it("lists all five kinds in display order", () => {
    expect(GUIDELINE_KINDS.map((k) => k.kind)).toEqual(["social_style", "social_post_spec", "blog_style", "blog_post_spec", "pin_spec"]);
  });
  it("type-guards unknown strings", () => {
    expect(isGuidelineKind("blog_style")).toBe(true);
    expect(isGuidelineKind("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/guidelines/kinds.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement kinds**

`src/lib/guidelines/kinds.ts`:

```ts
import type { Database } from "@/lib/database.types";

export type GuidelineKind = Database["public"]["Enums"]["guideline_kind"];

export const GUIDELINE_KINDS: { kind: GuidelineKind; label: string; description: string }[] = [
  { kind: "social_style", label: "Social style", description: "Voice, tone, vocabulary, emoji policy, hashtags, things to never say." },
  { kind: "social_post_spec", label: "Social post spec", description: "Required structure of a caption: hook, body, CTA, credibility block, links." },
  { kind: "blog_style", label: "Blog style", description: "Article voice, SEO rules, headings, internal links, alt text conventions." },
  { kind: "blog_post_spec", label: "Blog post spec", description: "The mechanical contract: images, SEO fields, WordPress push workflow." },
  { kind: "pin_spec", label: "Pinterest pin spec", description: "Title and description rules for pins, board selection, link policy." },
];

const SET = new Set<string>(GUIDELINE_KINDS.map((k) => k.kind));
export function isGuidelineKind(v: string): v is GuidelineKind {
  return SET.has(v);
}
```

- [ ] **Step 4: Run kinds test**

Run: `npx vitest run src/lib/guidelines/kinds.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Queries and action**

`src/lib/guidelines/queries.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import { GUIDELINE_KINDS, type GuidelineKind } from "./kinds";

export async function getGuidelines(brandId: string): Promise<Record<GuidelineKind, string>> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("brand_guidelines").select("kind,body_md").eq("brand_id", brandId);
  if (error) throw new Error(error.message);
  const out = Object.fromEntries(GUIDELINE_KINDS.map((k) => [k.kind, ""])) as Record<GuidelineKind, string>;
  for (const row of data) out[row.kind] = row.body_md;
  return out;
}
```

`src/lib/guidelines/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { isGuidelineKind, type GuidelineKind } from "./kinds";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveGuideline(
  brandId: string,
  kind: GuidelineKind,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  if (!isGuidelineKind(kind)) return { ok: false, error: "Unknown guideline kind" };
  const body_md = String(formData.get("body_md") ?? "");

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { error } = await supabase
    .from("brand_guidelines")
    .upsert({ brand_id: brandId, kind, body_md, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "brand_id,kind" });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/brands`, "layout");
  return { ok: true };
}
```

- [ ] **Step 6: Editor component**

`src/components/brands/guideline-editor.tsx`:

```tsx
"use client";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveGuideline, type ActionResult } from "@/lib/guidelines/actions";
import type { GuidelineKind } from "@/lib/guidelines/kinds";

export function GuidelineEditor({ brandId, kind, initial, description }: { brandId: string; kind: GuidelineKind; initial: string; description: string }) {
  const action = saveGuideline.bind(null, brandId, kind);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success("Saved");
    else toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-sm text-muted-foreground">{description}</p>
      <Textarea name="body_md" defaultValue={initial} rows={22} className="font-mono text-sm" placeholder="Markdown..." />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 7: Guidelines page with tabs**

`src/app/(app)/brands/[slug]/guidelines/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands/queries";
import { getGuidelines } from "@/lib/guidelines/queries";
import { GUIDELINE_KINDS } from "@/lib/guidelines/kinds";
import { GuidelineEditor } from "@/components/brands/guideline-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandNav } from "../brand-nav";

export const metadata = { title: "Guidelines" };

export default async function GuidelinesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const docs = await getGuidelines(brand.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{brand.name}</h1>
      <BrandNav slug={brand.slug} />
      <Tabs defaultValue={GUIDELINE_KINDS[0].kind} className="max-w-4xl">
        <TabsList>
          {GUIDELINE_KINDS.map((k) => (
            <TabsTrigger key={k.kind} value={k.kind}>
              {k.label}
              {docs[k.kind].trim() === "" && <span className="ml-1 text-muted-foreground">·</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        {GUIDELINE_KINDS.map((k) => (
          <TabsContent key={k.kind} value={k.kind} className="pt-4">
            <GuidelineEditor brandId={brand.id} kind={k.kind} initial={docs[k.kind]} description={k.description} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 8: Verify manually**

Write some markdown in "Social style", Save → toast "Saved"; reload → text persists; other tabs start empty.

- [ ] **Step 9: Typecheck, lint, test, commit**

```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat(guidelines): per-brand markdown guideline documents"
```

---

### Task 11: Media library (upload, grid, edit alt/tags, delete)

**Files:**
- Create: `src/lib/media/schema.ts`, `src/lib/media/schema.test.ts`, `src/lib/media/queries.ts`, `src/lib/media/actions.ts`, `src/components/media/upload-form.tsx`, `src/components/media/asset-grid.tsx`, `src/components/media/asset-dialog.tsx`, `src/app/(app)/media/page.tsx`

**Interfaces:**
- Consumes: `getCurrentBrandSlug`, `listBrands`, `getBrandBySlug` (Task 6); `createAdminSupabase` (Task 2).
- Produces:
  - `parseTags(input: string): string[]` (comma-separated → trimmed, lowercased, deduped, no empties); `validateUpload(file: { type: string; size: number })` → `{ ok: true } | { ok: false; error }`; `MAX_UPLOAD_BYTES = 20 * 1024 * 1024`.
  - `listMediaAssets(brandId, { tag?, limit? }): Promise<MediaAsset[]>`.
  - Server actions `uploadMedia(brandId, prev, formData)`, `updateMediaAsset(id, prev, formData)`, `deleteMediaAsset(id)`.

- [ ] **Step 1: Failing schema tests**

`src/lib/media/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseTags, validateUpload, MAX_UPLOAD_BYTES } from "@/lib/media/schema";

describe("parseTags", () => {
  it("splits on commas, trims, lowercases, dedupes, drops empties", () => {
    expect(parseTags(" Shop, exterior ,,SHOP, Interior ")).toEqual(["shop", "exterior", "interior"]);
  });
  it("returns [] for blank input", () => {
    expect(parseTags("")).toEqual([]);
  });
});

describe("validateUpload", () => {
  it("accepts a small image", () => {
    expect(validateUpload({ type: "image/jpeg", size: 1000 })).toEqual({ ok: true });
  });
  it("rejects non-images", () => {
    const r = validateUpload({ type: "application/pdf", size: 1000 });
    expect(r).toEqual({ ok: false, error: "Only image files are allowed" });
  });
  it("rejects files over 20 MB", () => {
    const r = validateUpload({ type: "image/png", size: MAX_UPLOAD_BYTES + 1 });
    expect(r).toEqual({ ok: false, error: "Images must be 20 MB or smaller" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/media/schema.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement schema helpers**

`src/lib/media/schema.ts`:

```ts
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of input.split(",")) {
    const t = raw.trim().toLowerCase();
    if (t && !seen.has(t)) seen.add(t);
  }
  return [...seen];
}

export function validateUpload(file: { type: string; size: number }): { ok: true } | { ok: false; error: string } {
  if (!file.type.startsWith("image/")) return { ok: false, error: "Only image files are allowed" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Images must be 20 MB or smaller" };
  return { ok: true };
}

export function extensionFor(mime: string, filename: string): string {
  const fromName = filename.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return mime.split("/")[1] ?? "bin";
}
```

- [ ] **Step 4: Run schema tests**

Run: `npx vitest run src/lib/media/schema.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Queries**

`src/lib/media/queries.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type MediaAsset = Database["public"]["Tables"]["media_assets"]["Row"];

export async function listMediaAssets(brandId: string, opts: { tag?: string; limit?: number } = {}): Promise<MediaAsset[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from("media_assets")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.tag) q = q.contains("tags", [opts.tag]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}
```

- [ ] **Step 6: Actions**

`src/lib/media/actions.ts`:

```ts
"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { parseTags, validateUpload, extensionFor } from "./schema";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function currentUserId(): Promise<string | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function uploadMedia(brandId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: "Choose at least one image" };
  const altText = String(formData.get("alt_text") ?? "").trim() || null;
  const tags = parseTags(String(formData.get("tags") ?? ""));

  const admin = createAdminSupabase();
  const failures: string[] = [];

  for (const file of files) {
    const v = validateUpload(file);
    if (!v.ok) {
      failures.push(`${file.name}: ${v.error}`);
      continue;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    let width: number | null = null;
    let height: number | null = null;
    try {
      const m = await sharp(bytes).metadata();
      width = m.width ?? null;
      height = m.height ?? null;
    } catch {
      // Not fatal; dimensions stay null.
    }

    const path = `${brandId}/${randomUUID()}.${extensionFor(file.type, file.name)}`;
    const { error: upErr } = await admin.storage.from("media").upload(path, bytes, { contentType: file.type, upsert: false });
    if (upErr) {
      failures.push(`${file.name}: ${upErr.message}`);
      continue;
    }
    const { data: pub } = admin.storage.from("media").getPublicUrl(path);

    const { error: dbErr } = await admin.from("media_assets").insert({
      brand_id: brandId,
      storage_path: path,
      public_url: pub.publicUrl,
      filename: file.name,
      mime_type: file.type,
      width,
      height,
      alt_text: altText,
      tags,
      uploaded_by: userId,
    });
    if (dbErr) {
      await admin.storage.from("media").remove([path]);
      failures.push(`${file.name}: ${dbErr.message}`);
    }
  }

  revalidatePath("/media");
  if (failures.length === files.length) return { ok: false, error: failures.join("; ") };
  if (failures.length > 0) return { ok: false, error: `Some files failed: ${failures.join("; ")}` };
  return { ok: true };
}

export async function updateMediaAsset(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await currentUserId())) return { ok: false, error: "Not signed in" };
  const alt_text = String(formData.get("alt_text") ?? "").trim() || null;
  const tags = parseTags(String(formData.get("tags") ?? ""));
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("media_assets").update({ alt_text, tags }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/media");
  return { ok: true };
}

export async function deleteMediaAsset(id: string): Promise<ActionResult> {
  if (!(await currentUserId())) return { ok: false, error: "Not signed in" };
  const admin = createAdminSupabase();
  const { data: row, error: readErr } = await admin.from("media_assets").select("storage_path").eq("id", id).single();
  if (readErr || !row) return { ok: false, error: "Asset not found" };
  const { error: rmErr } = await admin.storage.from("media").remove([row.storage_path]);
  if (rmErr) return { ok: false, error: rmErr.message };
  const { error: delErr } = await admin.from("media_assets").delete().eq("id", id);
  if (delErr) return { ok: false, error: delErr.message };
  revalidatePath("/media");
  return { ok: true };
}
```

- [ ] **Step 7: Upload form**

`src/components/media/upload-form.tsx`:

```tsx
"use client";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadMedia, type ActionResult } from "@/lib/media/actions";

export function UploadForm({ brandId }: { brandId: string }) {
  const action = uploadMedia.bind(null, brandId);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Uploaded");
      formRef.current?.reset();
    } else toast.error(state.error);
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <div className="space-y-1">
        <Label htmlFor="files">Images</Label>
        <Input id="files" name="files" type="file" accept="image/*" multiple required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="alt_text">Alt text (applied to all)</Label>
        <Input id="alt_text" name="alt_text" placeholder="40x60 shop with wainscot, Spokane WA" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tags">Tags (comma separated)</Label>
        <Input id="tags" name="tags" placeholder="shop, exterior" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading..." : "Upload"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 8: Asset dialog and grid**

`src/components/media/asset-dialog.tsx`:

```tsx
"use client";
import { useActionState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMediaAsset, deleteMediaAsset, type ActionResult } from "@/lib/media/actions";
import type { MediaAsset } from "@/lib/media/queries";

export function AssetDialog({ asset, onClose }: { asset: MediaAsset | null; onClose: () => void }) {
  const [deleting, startDelete] = useTransition();
  const action = asset ? updateMediaAsset.bind(null, asset.id) : async () => ({ ok: false as const, error: "No asset" });
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Saved");
      onClose();
    } else toast.error(state.error);
  }, [state, onClose]);

  if (!asset) return null;

  function remove() {
    if (!asset || !confirm(`Delete ${asset.filename}? This cannot be undone.`)) return;
    startDelete(async () => {
      const r = await deleteMediaAsset(asset.id);
      if (r.ok) {
        toast.success("Deleted");
        onClose();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{asset.filename}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.public_url} alt={asset.alt_text ?? ""} className="w-full rounded-md object-contain" />
          <form action={formAction} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="alt_text">Alt text</Label>
              <Input id="alt_text" name="alt_text" defaultValue={asset.alt_text ?? ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tags">Tags</Label>
              <Input id="tags" name="tags" defaultValue={asset.tags.join(", ")} />
            </div>
            <p className="text-xs text-muted-foreground">
              {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}
              {asset.mime_type}
            </p>
            <p className="break-all text-xs text-muted-foreground">{asset.public_url}</p>
            <div className="flex justify-between">
              <Button type="button" variant="destructive" onClick={remove} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete"}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

`src/components/media/asset-grid.tsx`:

```tsx
"use client";
import { useState } from "react";
import { AssetDialog } from "./asset-dialog";
import type { MediaAsset } from "@/lib/media/queries";

export function AssetGrid({ assets }: { assets: MediaAsset[] }) {
  const [open, setOpen] = useState<MediaAsset | null>(null);
  if (assets.length === 0) return <p className="text-muted-foreground">No images yet. Upload some above.</p>;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {assets.map((a) => (
          <button key={a.id} type="button" onClick={() => setOpen(a)} className="group overflow-hidden rounded-md border bg-muted/30 text-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.public_url} alt={a.alt_text ?? ""} className="aspect-square w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
            <div className="truncate px-2 py-1 text-xs text-muted-foreground">{a.alt_text ?? a.filename}</div>
          </button>
        ))}
      </div>
      <AssetDialog asset={open} onClose={() => setOpen(null)} />
    </>
  );
}
```

- [ ] **Step 9: Media page**

`src/app/(app)/media/page.tsx`:

```tsx
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { listMediaAssets } from "@/lib/media/queries";
import { UploadForm } from "@/components/media/upload-form";
import { AssetGrid } from "@/components/media/asset-grid";
import Link from "next/link";

export const metadata = { title: "Media" };

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const { tag } = await searchParams;
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];

  if (!brand) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Media</h1>
        <p className="text-muted-foreground">
          Create a brand first. <Link className="underline" href="/brands/new">New brand</Link>
        </p>
      </div>
    );
  }

  const assets = await listMediaAssets(brand.id, { tag });
  const allTags = [...new Set(assets.flatMap((a) => a.tags))].sort();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Media</h1>
        <p className="text-sm text-muted-foreground">{brand.name} library. Switch brands in the header.</p>
      </div>
      <UploadForm brandId={brand.id} />
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/media" className={!tag ? "font-medium underline" : "text-muted-foreground"}>All</Link>
          {allTags.map((t) => (
            <Link key={t} href={`/media?tag=${encodeURIComponent(t)}`} className={tag === t ? "font-medium underline" : "text-muted-foreground"}>
              {t}
            </Link>
          ))}
        </div>
      )}
      <AssetGrid assets={assets} />
    </div>
  );
}
```

- [ ] **Step 10: Raise the Server Action body limit**

Next.js caps Server Action bodies at 1 MB by default. In `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "dpihndeejbirskdrjfeh.supabase.co" }],
  },
};

export default nextConfig;
```

- [ ] **Step 11: Verify manually**

Upload two JPGs with tags "shop, exterior" → grid shows them; click one → dialog shows dimensions and public URL; edit alt → "Saved"; filter by tag; delete → gone from grid and from Supabase Storage (check dashboard). Try a PDF → error "Only image files are allowed".

- [ ] **Step 12: Typecheck, lint, test, commit**

```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat(media): per-brand media library with upload, edit, delete"
```

---

### Task 12: Dashboard with connection health

**Files:**
- Create: `src/lib/dashboard/queries.ts`
- Modify: `src/app/(app)/dashboard/page.tsx` (replace placeholder)

**Interfaces:**
- Consumes: `listBrands` (Task 6), `StatusBadge` (Task 9), `PROVIDER_ORDER`, `PROVIDER_LABELS` (Task 8).
- Produces: `getDashboardBrands(): Promise<DashboardBrand[]>` where `DashboardBrand = Brand & { connections: Record<Provider, ConnectionStatus | "missing">; media_count: number }`.

- [ ] **Step 1: Query**

`src/lib/dashboard/queries.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import { listBrands, type Brand } from "@/lib/brands/queries";
import { PROVIDER_ORDER, type Provider } from "@/lib/connections";
import type { Database } from "@/lib/database.types";

type ConnectionStatus = Database["public"]["Enums"]["connection_status"];
export type DashboardBrand = Brand & {
  connections: Record<Provider, ConnectionStatus | "missing">;
  media_count: number;
};

export async function getDashboardBrands(): Promise<DashboardBrand[]> {
  const supabase = await createServerSupabase();
  const brands = await listBrands();
  const ids = brands.map((b) => b.id);
  if (ids.length === 0) return [];

  const [{ data: conns, error: cErr }, { data: media, error: mErr }] = await Promise.all([
    supabase.from("brand_connections").select("brand_id,provider,status").in("brand_id", ids),
    supabase.from("media_assets").select("brand_id").in("brand_id", ids),
  ]);
  if (cErr) throw new Error(cErr.message);
  if (mErr) throw new Error(mErr.message);

  return brands.map((b) => {
    const connections = Object.fromEntries(PROVIDER_ORDER.map((p) => [p, "missing"])) as DashboardBrand["connections"];
    for (const c of conns ?? []) if (c.brand_id === b.id) connections[c.provider as Provider] = c.status;
    const media_count = (media ?? []).filter((m) => m.brand_id === b.id).length;
    return { ...b, connections, media_count };
  });
}
```

- [ ] **Step 2: Dashboard page**

Replace `src/app/(app)/dashboard/page.tsx`:

```tsx
import Link from "next/link";
import { getDashboardBrands } from "@/lib/dashboard/queries";
import { PROVIDER_ORDER, PROVIDER_LABELS } from "@/lib/connections";
import { StatusBadge } from "@/components/brands/connection-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const brands = await getDashboardBrands();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Button asChild>
          <Link href="/brands/new">New brand</Link>
        </Button>
      </div>
      {brands.length === 0 ? (
        <p className="text-muted-foreground">No active brands. Create your first client to get started.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {brands.map((b) => (
            <Card key={b.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  <Link href={`/brands/${b.slug}`} className="hover:underline">
                    {b.name}
                  </Link>
                </CardTitle>
                <p className="text-sm text-muted-foreground">{b.website_url ?? "No website"}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                <ul className="space-y-1 text-sm">
                  {PROVIDER_ORDER.map((p) => (
                    <li key={p} className="flex items-center justify-between">
                      <span>{PROVIDER_LABELS[p]}</span>
                      <StatusBadge status={b.connections[p]} />
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {b.media_count} image{b.media_count === 1 ? "" : "s"} in library ·{" "}
                  <Link href={`/brands/${b.slug}/connections`} className="underline">
                    Connections
                  </Link>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify manually**

`/dashboard` shows one card per active brand with four status badges matching the connections page, and a media count.

- [ ] **Step 4: Typecheck, lint, test, commit**

```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat(dashboard): brand cards with connection health and media counts"
```

---

### Task 13: Playwright smoke test

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`, `e2e/fixtures/pixel.png`

**Interfaces:**
- Consumes: a real invited user in `E2E_EMAIL` / `E2E_PASSWORD` (from `.env.local`), the running dev server.

- [ ] **Step 1: Install browsers**

```bash
npx playwright install chromium
```

- [ ] **Step 2: Config**

`playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: { command: "npm run dev", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 120_000 },
  reporter: [["list"]],
});
```

Install dotenv: `npm install -D dotenv`.

- [ ] **Step 3: Fixture image**

Create a 1x1 PNG:

```bash
mkdir -p e2e/fixtures
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7V\xbd\xfa\x00\x00\x00\x00IEND\xaeB`\x82' > e2e/fixtures/pixel.png
file e2e/fixtures/pixel.png   # expect: PNG image data, 1 x 1
```

- [ ] **Step 4: Smoke spec**

`e2e/smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import path from "node:path";

const email = process.env.E2E_EMAIL!;
const password = process.env.E2E_PASSWORD!;
const stamp = Date.now();
const brandName = `E2E Brand ${stamp}`;
const slug = `e2e-brand-${stamp}`;

test.describe.configure({ mode: "serial" });

test("redirects anonymous users to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("JamSam Digital team access only.")).toBeVisible();
});

test("login, create brand, upload image, see it in library", async ({ page }) => {
  test.skip(!email || !password, "E2E_EMAIL / E2E_PASSWORD not set");

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/brands/new");
  await page.getByLabel("Client name").fill(brandName);
  await expect(page.getByLabel("Slug")).toHaveValue(slug);
  await page.getByRole("button", { name: "Create brand" }).click();
  await expect(page).toHaveURL(new RegExp(`/brands/${slug}$`));
  await expect(page.getByRole("heading", { name: brandName })).toBeVisible();

  // Select the new brand in the header, then upload.
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: brandName }).click();
  await page.goto("/media");
  await expect(page.getByText(`${brandName} library`)).toBeVisible();
  await page.getByLabel("Images").setInputFiles(path.join(__dirname, "fixtures/pixel.png"));
  await page.getByLabel("Alt text (applied to all)").fill("e2e pixel");
  await page.getByLabel("Tags (comma separated)").fill("e2e");
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("e2e pixel")).toBeVisible();

  // Cleanup: delete the asset, archive the brand.
  await page.getByRole("button", { name: /e2e pixel/ }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No images yet")).toBeVisible();

  await page.goto(`/brands/${slug}`);
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived")).toBeVisible();
});
```

- [ ] **Step 5: Run**

Run: `npm run e2e`
Expected: 2 passed (the second is skipped if `E2E_*` are unset; set them in `.env.local` to the user invited in Task 5).

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts e2e package.json package-lock.json
git commit -m "test(e2e): Playwright smoke for login, brand, media upload"
```

---

### Task 14: Deploy to Vercel

**Files:**
- Create: `vercel.json` (only if needed; default settings work for Next.js), `.vercel/` is gitignored automatically by the CLI

- [ ] **Step 1: Link the local project to the existing Vercel project**

```bash
npx vercel login          # if needed; user completes in browser
npx vercel link           # choose the existing jamsam-social project
```

If interactive login is needed, ask the user to run `! npx vercel login`.

- [ ] **Step 2: Set production + preview env vars**

For each variable, run (paste the value when prompted; use the same values as `.env.local` except `NEXT_PUBLIC_APP_URL`):

```bash
for env in production preview; do
  npx vercel env add NEXT_PUBLIC_SUPABASE_URL $env
  npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY $env
  npx vercel env add SUPABASE_SERVICE_ROLE_KEY $env
  npx vercel env add CONNECTIONS_ENCRYPTION_KEY $env
  npx vercel env add NEXT_PUBLIC_APP_URL $env
done
```

`NEXT_PUBLIC_APP_URL` for production is the Vercel production domain (e.g. `https://jamsam-social.vercel.app`). Use the **same** `CONNECTIONS_ENCRYPTION_KEY` as local, otherwise secrets saved locally cannot be decrypted in production (and vice versa).

- [ ] **Step 3: Add the Vercel domain to Supabase Auth**

Supabase dashboard → Authentication → URL Configuration: set Site URL to the production domain and add `https://*.vercel.app/**` to Redirect URLs (covers preview deployments).

- [ ] **Step 4: Deploy a preview from this branch**

```bash
npx vercel
```

Expected: a preview URL. Open it → login page renders → sign in works → dashboard loads.

- [ ] **Step 5: Commit any config**

```bash
git add -A
git commit -m "chore: vercel project config" || echo "nothing to commit"
```

---

### Task 15: Push to GitHub, open PR, merge to main

**Files:** none new.

- [ ] **Step 1: Point origin at the JamSam repo and push**

```bash
git remote -v
# if origin is missing or points elsewhere:
git remote remove origin 2>/dev/null; git remote add origin https://github.com/jamsamcreative/jamsam-social.git
git push -u origin i-want-to-create-my-own-versio
```

If `gh` is authenticated as `jamsamdigital` and that account lacks push access to `jamsamcreative/jamsam-social`, ask the user to either add `jamsamdigital` as a collaborator or run `! gh auth login` for the `jamsamcreative` account.

- [ ] **Step 2: Ensure `main` exists on the remote**

The remote is empty. Push `main` first so the PR has a base:

```bash
git branch -f main a9fee8e          # the "Initial commit"
git push origin main
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --repo jamsamcreative/jamsam-social --base main --head i-want-to-create-my-own-versio \
  --title "Phase 1: Foundation (auth, brands, connections, guidelines, media)" \
  --body "$(cat <<'EOF'
## Summary
- Next.js 16 + Supabase scaffold with team-only login
- Brands (clients) CRUD with encrypted per-brand connections (WordPress, Meta, Pinterest, SEMrush) and real Save & test
- Brand guideline documents (5 kinds)
- Per-brand media library on Supabase Storage
- Dashboard with connection health
- Vitest unit tests, Playwright smoke, GitHub Actions CI

Spec: docs/superpowers/specs/2026-09-12-jamsam-social-phase1-foundation-design.md
Plan: docs/superpowers/plans/2026-09-12-jamsam-social-phase1-foundation.md

## Test plan
- [ ] CI green
- [ ] Preview deploy: login, create brand, connect a real WordPress site (green), upload image
- [ ] `npm run e2e` passes locally

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Wait for CI, merge, confirm production deploy**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
```

Vercel auto-deploys `main` to production. Open the production URL and repeat the login → dashboard check. Phase 1 definition of done is met when: login works in production, a real WordPress and Meta connection test green for a live client, a guideline doc saves, an image uploads and appears, CI is green.
