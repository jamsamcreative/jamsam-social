# JamSam Social Phase 3 (Articles → WordPress) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write SEO articles in a rich-text editor, push them to the brand's WordPress as drafts with images re-hosted and Yoast fields set, and publish/sync from the app.

**Architecture:** One `articles` table plus an image-rehost map. A thin WordPress REST client (`lib/wordpress/client.ts`) is used by pure, testable push/publish payload builders (`lib/articles/push.ts`) and orchestrated by Server Actions. A generated helper plugin zip exposes Yoast meta to REST. UI is a two-column Tiptap editor page reusing the Phase 2 media picker.

**Tech Stack:** Next.js 16, Supabase, Tiptap 3 (`@tiptap/react`, `starter-kit`, `extension-link`, `extension-image`), `jszip` (plugin zip), WordPress REST API v2, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-jamsam-social-phase3-articles-design.md`

## Global Constraints

- Branch `phase-3-articles` (exists, based on main). Conventional commits after each task.
- Statuses: `draft, pushed_to_wp, published, archived`. Decisions: `new, rewrite, optimize`. Sources: `manual, ai`.
- Push always creates/updates the WP post as **draft**; only `publishArticle` changes WP status (`publish` or `future`).
- Yoast meta keys: `_yoast_wpseo_title`, `_yoast_wpseo_metadesc`, `_yoast_wpseo_focuskw`; sent only when the helper is installed.
- `seo_title` gets the brand `seo_suffix` appended when set and missing. Meta description 120–156 chars is a warning, not a block.
- All WP calls: 20 s timeout, errors become `WpError`. Secrets via `getConnectionWithSecret(brandId, "wordpress")` only.
- Base UI: `nativeButton={false} render={<Link/>}` for link buttons. No em dashes in UI copy.

---

### Task 1: Migration, types, dependencies

**Files:**
- Create: `supabase/migrations/0003_articles.sql`
- Modify: `src/lib/database.types.ts`, `package.json`

**Interfaces:** tables `articles`, `article_media_map`; enums `article_status`, `article_decision`, `article_source`; types `ArticleRow`, `ArticleMediaMapRow`; `TermRef = { id: number; name: string }`.

- [ ] **Step 1: Migration**

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
  featured_media     jsonb,
  categories         jsonb not null default '[]'::jsonb,
  tags               jsonb not null default '[]'::jsonb,
  decision           article_decision not null default 'new',
  rationale          text,
  source             article_source not null default 'manual',
  status             article_status not null default 'draft',
  wp_post_id         int,
  wp_link            text,
  wp_status          text,
  pushed_at          timestamptz,
  published_at       timestamptz,
  last_error         text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (brand_id, slug)
);
create index articles_brand_status_idx on articles (brand_id, status, updated_at desc);
create trigger articles_updated_at before update on articles for each row execute function set_updated_at();

create table article_media_map (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  source_url   text not null,
  wp_media_id  int not null,
  wp_url       text not null,
  created_at   timestamptz not null default now(),
  unique (brand_id, source_url)
);

alter table articles          enable row level security;
alter table article_media_map enable row level security;
create policy "authenticated full access" on articles          for all to authenticated using (true) with check (true);
create policy "authenticated full access" on article_media_map for all to authenticated using (true) with check (true);
```

Apply: `npx supabase db push --db-url "$DB_URL"`.

- [ ] **Step 2: Types** — add to `database.types.ts`:

```ts
export type TermRef = { id: number; name: string };
type ArticleRow = {
  id: string; brand_id: string; title: string; slug: string; content_html: string; excerpt: string | null;
  seo_title: string | null; meta_description: string | null; primary_keyword: string | null; secondary_keywords: string[];
  featured_media: Json | null; categories: Json; tags: Json; decision: "new" | "rewrite" | "optimize"; rationale: string | null;
  source: "manual" | "ai"; status: "draft" | "pushed_to_wp" | "published" | "archived";
  wp_post_id: number | null; wp_link: string | null; wp_status: string | null; pushed_at: string | null; published_at: string | null;
  last_error: string | null; created_by: string | null; created_at: string; updated_at: string;
};
type ArticleMediaMapRow = { id: string; brand_id: string; source_url: string; wp_media_id: number; wp_url: string; created_at: string };
```

Register `articles: Table<ArticleRow, "brand_id" | "title" | "slug">`, `article_media_map: Table<ArticleMediaMapRow, "brand_id" | "source_url" | "wp_media_id" | "wp_url">`, enums `article_status`, `article_decision`, `article_source`.

- [ ] **Step 3: Dependencies**

```bash
npm install @tiptap/react@3.31.3 @tiptap/pm@3.31.3 @tiptap/starter-kit@3.31.3 @tiptap/extension-link@3.31.3 @tiptap/extension-image@3.31.3 jszip@3.10.2
```

- [ ] **Step 4:** `npm run typecheck && git add -A && git commit -m "feat(db): articles tables, types, editor deps"`

---

### Task 2: WordPress REST client and helper detection

**Files:**
- Create: `src/lib/wordpress/client.ts`, `src/lib/wordpress/client.test.ts`
- Modify: `src/lib/connections/wordpress.ts` (test() reports helper status)

**Interfaces:**
- `class WpError extends Error { status: number }`
- `createWpClient(config: WordpressConfig, secret: WordpressSecret, fetchImpl?): WpClient` where `WpClient = { get<T>(path, params?), post<T>(path, body, opts?), siteUrl: string }` — `path` is relative to `/wp-json` (e.g. `/wp/v2/posts`). `post` sends JSON unless `opts.raw` is given (`{ bytes: Buffer; contentType: string; filename: string }`).
- `listTerms(client, kind: "categories" | "tags"): Promise<TermRef[]>`
- `uploadMediaFromUrl(client, url: string, opts: { alt: string; filename?: string; fetchImpl? }): Promise<{ id: number; source_url: string }>`
- `createPost(client, payload: WpPostPayload)`, `updatePost(client, id, payload: Partial<WpPostPayload>)` → `WpPostResult = { id: number; link: string; status: string; date_gmt: string; slug: string }`; `getPost(client, id)` → same.
- `checkHelper(client): Promise<{ installed: boolean; version?: string }>`
- `WpPostPayload = { title; slug; content; excerpt?; status: "draft" | "publish" | "future"; date?: string; categories?: number[]; tags?: number[]; featured_media?: number; meta?: Record<string, string> }`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect, vi } from "vitest";
import { createWpClient, listTerms, uploadMediaFromUrl, createPost, checkHelper, WpError } from "@/lib/wordpress/client";

const cfg = { site_url: "https://client.com/", username: "u" };
const sec = { app_password: "p" };
const mock = (h: (u: URL, init?: RequestInit) => Response | Promise<Response>) => vi.fn((u: RequestInfo | URL, init?: RequestInit) => h(new URL(String(u)), init)) as unknown as typeof fetch;

describe("wp client", () => {
  it("lists terms across pages", async () => {
    const f = mock((u) => {
      const page = u.searchParams.get("page");
      const body = page === "1" ? [{ id: 1, name: "News" }] : [{ id: 2, name: "Tips" }];
      return new Response(JSON.stringify(body), { status: 200, headers: { "X-WP-TotalPages": "2" } });
    });
    expect(await listTerms(createWpClient(cfg, sec, f), "categories")).toEqual([{ id: 1, name: "News" }, { id: 2, name: "Tips" }]);
  });
  it("uploads media from a url and sets alt text", async () => {
    const calls: string[] = [];
    const f = mock(async (u, init) => {
      calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
      if (u.hostname === "img.example") return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
      if (u.pathname.endsWith("/wp/v2/media") && init?.method === "POST") {
        expect((init.headers as Record<string, string>)["Content-Disposition"]).toBe('attachment; filename="shop.jpg"');
        return new Response(JSON.stringify({ id: 55, source_url: "https://client.com/wp-content/uploads/shop.jpg" }), { status: 201 });
      }
      if (u.pathname.endsWith("/wp/v2/media/55")) return new Response(JSON.stringify({ id: 55 }), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    const r = await uploadMediaFromUrl(createWpClient(cfg, sec, f), "https://img.example/shop.jpg", { alt: "A shop", fetchImpl: f });
    expect(r).toEqual({ id: 55, source_url: "https://client.com/wp-content/uploads/shop.jpg" });
    expect(calls).toContain("POST /wp-json/wp/v2/media/55");
  });
  it("throws WpError with the WP message", async () => {
    const f = mock(() => new Response(JSON.stringify({ code: "rest_cannot_create", message: "Sorry, you are not allowed" }), { status: 401 }));
    await expect(createPost(createWpClient(cfg, sec, f), { title: "t", slug: "t", content: "", status: "draft" })).rejects.toBeInstanceOf(WpError);
    await expect(createPost(createWpClient(cfg, sec, f), { title: "t", slug: "t", content: "", status: "draft" })).rejects.toThrow(/not allowed/);
  });
  it("detects the helper plugin", async () => {
    const f = mock((u) => new Response(u.pathname.endsWith("/jamsam/v1/ping") ? JSON.stringify({ ok: true, version: "1.0.0" }) : "{}", { status: u.pathname.endsWith("/jamsam/v1/ping") ? 200 : 404 }));
    expect(await checkHelper(createWpClient(cfg, sec, f))).toEqual({ installed: true, version: "1.0.0" });
    const g = mock(() => new Response(JSON.stringify({ code: "rest_no_route" }), { status: 404 }));
    expect(await checkHelper(createWpClient(cfg, sec, g))).toEqual({ installed: false });
  });
});
```

- [ ] **Step 2: Implement `client.ts`**

```ts
import { fetchWithTimeout } from "@/lib/connections/http";
import { wpAuthHeader, wpBase, type WordpressConfig, type WordpressSecret } from "@/lib/connections/wordpress";
import type { TermRef } from "@/lib/database.types";

export class WpError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.name = "WpError"; this.status = status; }
}

export type WpClient = {
  siteUrl: string;
  get<T>(path: string, params?: Record<string, string>): Promise<{ data: T; headers: Headers }>;
  post<T>(path: string, body: unknown, opts?: { raw?: { bytes: Buffer; contentType: string; filename: string } }): Promise<T>;
};

export function createWpClient(config: WordpressConfig, secret: WordpressSecret, fetchImpl: typeof fetch = fetch): WpClient {
  const base = `${wpBase(config.site_url)}/wp-json`;
  const auth = wpAuthHeader(config.username, secret.app_password);
  async function parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok) {
      const msg = (json as { message?: string } | null)?.message ?? `WordPress responded ${res.status}`;
      throw new WpError(msg, res.status);
    }
    if (json === null) throw new WpError("WordPress did not return JSON", res.status);
    return json as T;
  }
  return {
    siteUrl: wpBase(config.site_url),
    async get(path, params) {
      const u = new URL(`${base}${path}`);
      for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
      const res = await fetchWithTimeout(u, { headers: { Authorization: auth, Accept: "application/json" } }, 20_000, fetchImpl);
      return { data: await parse(res), headers: res.headers };
    },
    async post(path, body, opts) {
      const headers: Record<string, string> = { Authorization: auth, Accept: "application/json" };
      let payload: BodyInit;
      if (opts?.raw) {
        headers["Content-Type"] = opts.raw.contentType;
        headers["Content-Disposition"] = `attachment; filename="${opts.raw.filename}"`;
        payload = new Uint8Array(opts.raw.bytes);
      } else {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const res = await fetchWithTimeout(`${base}${path}`, { method: "POST", headers, body: payload }, 20_000, fetchImpl);
      return parse(res);
    },
  };
}

export async function listTerms(client: WpClient, kind: "categories" | "tags"): Promise<TermRef[]> {
  const out: TermRef[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, headers } = await client.get<{ id: number; name: string }[]>(`/wp/v2/${kind}`, { per_page: "100", page: String(page), _fields: "id,name" });
    out.push(...data.map((t) => ({ id: t.id, name: t.name })));
    if (page >= Number(headers.get("X-WP-TotalPages") ?? "1")) break;
  }
  return out;
}

export async function uploadMediaFromUrl(client: WpClient, url: string, opts: { alt: string; filename?: string; fetchImpl?: typeof fetch }): Promise<{ id: number; source_url: string }> {
  const f = opts.fetchImpl ?? fetch;
  const src = await fetchWithTimeout(url, {}, 20_000, f);
  if (!src.ok) throw new WpError(`Could not download image ${url} (${src.status})`, src.status);
  const contentType = src.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const bytes = Buffer.from(await src.arrayBuffer());
  const filename = opts.filename ?? (new URL(url).pathname.split("/").pop() || "image.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
  const created = await client.post<{ id: number; source_url: string }>("/wp/v2/media", null, { raw: { bytes, contentType, filename } });
  await client.post(`/wp/v2/media/${created.id}`, { alt_text: opts.alt, title: opts.alt });
  return { id: created.id, source_url: created.source_url };
}

export type WpPostPayload = {
  title: string; slug: string; content: string; excerpt?: string;
  status: "draft" | "publish" | "future"; date?: string;
  categories?: number[]; tags?: number[]; featured_media?: number; meta?: Record<string, string>;
};
export type WpPostResult = { id: number; link: string; status: string; date_gmt: string; slug: string };
const POST_FIELDS = "id,link,status,date_gmt,slug";

export async function createPost(client: WpClient, payload: WpPostPayload): Promise<WpPostResult> {
  return client.post<WpPostResult>(`/wp/v2/posts?_fields=${POST_FIELDS}`, payload);
}
export async function updatePost(client: WpClient, id: number, payload: Partial<WpPostPayload>): Promise<WpPostResult> {
  return client.post<WpPostResult>(`/wp/v2/posts/${id}?_fields=${POST_FIELDS}`, payload);
}
export async function getPost(client: WpClient, id: number): Promise<WpPostResult> {
  return (await client.get<WpPostResult>(`/wp/v2/posts/${id}`, { _fields: POST_FIELDS, context: "edit" })).data;
}

export async function checkHelper(client: WpClient): Promise<{ installed: boolean; version?: string }> {
  try {
    const { data } = await client.get<{ ok?: boolean; version?: string }>("/jamsam/v1/ping");
    return data.ok ? { installed: true, version: data.version } : { installed: false };
  } catch {
    return { installed: false };
  }
}
```

- [ ] **Step 3: Connection test reports helper** — in `src/lib/connections/wordpress.ts` `test()`, after success, call `checkHelper(createWpClient(config, secret, fetchImpl))` and append `. JamSam helper: installed` / `. JamSam helper: not installed (SEO fields will be skipped)`. Add a test case in `wordpress.test.ts` that mocks `/jamsam/v1/ping` 200 and asserts the detail contains "helper: installed". Avoid a circular import: `client.ts` imports only `wpAuthHeader`/`wpBase` types from `connections/wordpress.ts`; put those two helpers plus schemas in a new `src/lib/connections/wordpress-shared.ts` and re-export from `wordpress.ts`.

- [ ] **Step 4:** run tests, commit `feat(wordpress): REST client, media upload, helper detection`.

---

### Task 3: Helper plugin zip endpoint

**Files:**
- Create: `src/lib/wordpress/helper-plugin.ts`, `src/lib/wordpress/helper-plugin.test.ts`, `src/app/api/wp-plugin/jamsam-connector.zip/route.ts`
- Modify: `src/components/brands/connection-forms.tsx` (help text with download link for WordPress)

**Interfaces:** `HELPER_PLUGIN_PHP: string`, `HELPER_VERSION = "1.0.0"`, `buildHelperZip(): Promise<Buffer>` (folder `jamsam-connector/jamsam-connector.php`).

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildHelperZip, HELPER_PLUGIN_PHP } from "@/lib/wordpress/helper-plugin";

describe("helper plugin", () => {
  it("zips the php under the plugin folder", async () => {
    const zip = await JSZip.loadAsync(await buildHelperZip());
    const file = zip.file("jamsam-connector/jamsam-connector.php");
    expect(file).toBeTruthy();
    expect(await file!.async("string")).toBe(HELPER_PLUGIN_PHP);
  });
  it("registers the three yoast keys and the ping route", () => {
    for (const k of ["_yoast_wpseo_title", "_yoast_wpseo_metadesc", "_yoast_wpseo_focuskw", "jamsam/v1", "/ping"]) expect(HELPER_PLUGIN_PHP).toContain(k);
  });
});
```

- [ ] **Step 2: Implement** — `HELPER_PLUGIN_PHP` is the PHP from the spec verbatim; `buildHelperZip` uses `new JSZip().folder("jamsam-connector")!.file("jamsam-connector.php", HELPER_PLUGIN_PHP)` → `zip.generateAsync({ type: "nodebuffer" })`. Route: requires a signed-in user, returns the buffer with `Content-Type: application/zip` and `Content-Disposition: attachment; filename="jamsam-connector.zip"`. Add to the WordPress `app_password` field help: `Install the JamSam helper plugin for Yoast fields: download from /api/wp-plugin/jamsam-connector.zip (Plugins → Add New → Upload).` Render that path as a link in `ConnectionFields` when `f.name === "app_password" && provider === "wordpress"`.

- [ ] **Step 3:** tests, commit `feat(wordpress): downloadable Yoast helper plugin`.

---

### Task 4: Article schema, push/publish payload builders (pure)

**Files:**
- Create: `src/lib/articles/schema.ts`, `src/lib/articles/schema.test.ts`, `src/lib/articles/push.ts`, `src/lib/articles/push.test.ts`

**Interfaces:**
- `articleFormSchema` (zod): `{ id?, brand_id, title, slug, content_html, excerpt, seo_title, meta_description, primary_keyword, secondary_keywords: string[], featured_media: MediaItem | null, categories: TermRef[], tags: TermRef[], decision, rationale }`; `parseArticleForm(formData)` reads hidden `payload`.
- `finalSeoTitle(seoTitle: string | null, title: string, suffix: string | null): string`
- `metaDescriptionWarning(desc: string | null): string | null`
- `validateForPush(a): string | null`
- `extractImageUrls(html: string): string[]`, `rewriteImageUrls(html, map: Record<string,string>): string`
- `rehostImages({ html, featured, siteHost, lookup, upload }): Promise<{ html; featuredId: number | null; uploaded: number }>` where `lookup(url) → {wp_media_id, wp_url} | null` and `upload(url, alt) → {id, source_url}` are injected.
- `buildPostPayload(a, { html, featuredId, helperInstalled, suffix }): WpPostPayload`
- `buildPublishPayload(dateIso?: string): Partial<WpPostPayload>`

- [ ] **Step 1: Tests** (`push.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { finalSeoTitle, metaDescriptionWarning, extractImageUrls, rewriteImageUrls, rehostImages, buildPostPayload, buildPublishPayload, validateForPush } from "@/lib/articles/push";

describe("seo helpers", () => {
  it("appends the suffix once", () => {
    expect(finalSeoTitle("Best Shops", "x", " | Acme")).toBe("Best Shops | Acme");
    expect(finalSeoTitle("Best Shops | Acme", "x", " | Acme")).toBe("Best Shops | Acme");
    expect(finalSeoTitle(null, "Fallback", null)).toBe("Fallback");
  });
  it("warns on meta description length", () => {
    expect(metaDescriptionWarning("short")).toMatch(/120/);
    expect(metaDescriptionWarning("x".repeat(140))).toBeNull();
    expect(metaDescriptionWarning("x".repeat(170))).toMatch(/156/);
  });
});

describe("images", () => {
  const html = '<p>a</p><img src="https://cdn.x/1.jpg" alt="one"><img alt="two" src="https://client.com/wp-content/uploads/2.jpg">';
  it("extracts srcs", () => expect(extractImageUrls(html)).toEqual(["https://cdn.x/1.jpg", "https://client.com/wp-content/uploads/2.jpg"]));
  it("rewrites mapped srcs only", () => {
    expect(rewriteImageUrls(html, { "https://cdn.x/1.jpg": "https://client.com/u/1.jpg" })).toContain('src="https://client.com/u/1.jpg"');
    expect(rewriteImageUrls(html, {})).toBe(html);
  });
  it("rehosts external images and the featured image, skipping same-host and cached ones", async () => {
    const upload = vi.fn(async (url: string) => ({ id: url.includes("feat") ? 9 : 7, source_url: url.replace("cdn.x", "client.com/u") }));
    const lookup = vi.fn(async (url: string) => (url.endsWith("cached.jpg") ? { wp_media_id: 3, wp_url: "https://client.com/u/cached.jpg" } : null));
    const r = await rehostImages({
      html: html + '<img src="https://cdn.x/cached.jpg">',
      featured: { url: "https://cdn.x/feat.jpg", alt: "feat" },
      siteHost: "client.com", lookup, upload,
    });
    expect(upload).toHaveBeenCalledTimes(2); // 1.jpg + feat.jpg
    expect(r.featuredId).toBe(9);
    expect(r.html).toContain("https://client.com/u/1.jpg");
    expect(r.html).toContain("https://client.com/u/cached.jpg");
    expect(r.html).toContain("https://client.com/wp-content/uploads/2.jpg");
  });
  it("uses the alt attribute when uploading", async () => {
    const upload = vi.fn(async () => ({ id: 1, source_url: "https://client.com/u/1.jpg" }));
    await rehostImages({ html: '<img alt="Steel shop" src="https://cdn.x/1.jpg">', featured: null, siteHost: "client.com", lookup: async () => null, upload });
    expect(upload).toHaveBeenCalledWith("https://cdn.x/1.jpg", "Steel shop");
  });
});

const article = {
  title: "T", slug: "t", excerpt: "e", seo_title: "S", meta_description: "d".repeat(130), primary_keyword: "kw",
  categories: [{ id: 1, name: "News" }], tags: [{ id: 5, name: "x" }], featured_media: { url: "https://cdn.x/f.jpg", alt: "f" }, content_html: "<p>x</p>",
} as never;

describe("payloads", () => {
  it("builds a draft payload with yoast meta when helper installed", () => {
    const p = buildPostPayload(article, { html: "<p>y</p>", featuredId: 9, helperInstalled: true, suffix: " | A" });
    expect(p).toEqual({ title: "T", slug: "t", content: "<p>y</p>", excerpt: "e", status: "draft", categories: [1], tags: [5], featured_media: 9,
      meta: { _yoast_wpseo_title: "S | A", _yoast_wpseo_metadesc: "d".repeat(130), _yoast_wpseo_focuskw: "kw" } });
  });
  it("omits meta without the helper", () => {
    expect(buildPostPayload(article, { html: "", featuredId: null, helperInstalled: false, suffix: null }).meta).toBeUndefined();
  });
  it("publish payload now vs future", () => {
    expect(buildPublishPayload()).toEqual({ status: "publish" });
    expect(buildPublishPayload("2030-01-01T09:00:00.000Z")).toEqual({ status: "future", date_gmt: "2030-01-01T09:00:00" });
  });
  it("validates required fields for push", () => {
    expect(validateForPush(article)).toBeNull();
    expect(validateForPush({ ...article, featured_media: null })).toMatch(/featured/i);
    expect(validateForPush({ ...article, slug: "Bad Slug" })).toMatch(/slug/i);
    expect(validateForPush({ ...article, content_html: "  " })).toMatch(/content/i);
  });
});
```

Note `buildPublishPayload` uses `date_gmt` (WP accepts `date_gmt` without offset). Update the `WpPostPayload` type in Task 2 to include `date_gmt?: string` (remove `date`).

- [ ] **Step 2: Implement `push.ts`** (pure; no Supabase imports)

```ts
import type { WpPostPayload } from "@/lib/wordpress/client";
import type { MediaItem, TermRef } from "@/lib/database.types";

export type ArticleLike = {
  title: string; slug: string; content_html: string; excerpt: string | null; seo_title: string | null; meta_description: string | null;
  primary_keyword: string | null; featured_media: MediaItem | null; categories: TermRef[]; tags: TermRef[];
};

export function finalSeoTitle(seoTitle: string | null, title: string, suffix: string | null): string {
  const base = (seoTitle?.trim() || title).trim();
  if (!suffix) return base;
  return base.endsWith(suffix.trim()) || base.endsWith(suffix) ? base : `${base}${suffix}`;
}

export function metaDescriptionWarning(desc: string | null): string | null {
  const n = desc?.trim().length ?? 0;
  if (n === 0) return "No meta description set";
  if (n < 120) return `Meta description is ${n} chars; aim for 120 to 156`;
  if (n > 156) return `Meta description is ${n} chars; aim for 120 to 156`;
  return null;
}

export function validateForPush(a: ArticleLike): string | null {
  if (!a.title.trim()) return "Title is required";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug)) return "Slug may only contain lowercase letters, numbers, and hyphens";
  if (!a.content_html.trim()) return "Article content is empty";
  if (!a.featured_media?.url) return "A featured image is required";
  return null;
}

const IMG_RE = /<img\b[^>]*>/gi;
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? tag.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, "i"))?.[1] ?? null;

export function extractImageUrls(html: string): string[] {
  return [...new Set((html.match(IMG_RE) ?? []).map((t) => attr(t, "src")).filter((s): s is string => Boolean(s)))];
}

export function rewriteImageUrls(html: string, map: Record<string, string>): string {
  return html.replace(IMG_RE, (tag) => {
    const src = attr(tag, "src");
    if (!src || !map[src]) return tag;
    return tag.replace(src, map[src]);
  });
}

function imageAlts(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of html.match(IMG_RE) ?? []) {
    const src = attr(tag, "src");
    if (src) out[src] = attr(tag, "alt") ?? "";
  }
  return out;
}

export async function rehostImages(opts: {
  html: string;
  featured: MediaItem | null;
  siteHost: string;
  lookup: (url: string) => Promise<{ wp_media_id: number; wp_url: string } | null>;
  upload: (url: string, alt: string) => Promise<{ id: number; source_url: string }>;
}): Promise<{ html: string; featuredId: number | null; uploaded: number }> {
  const isExternal = (u: string) => { try { return new URL(u).hostname !== opts.siteHost; } catch { return false; } };
  const alts = imageAlts(opts.html);
  const map: Record<string, string> = {};
  let uploaded = 0;
  async function resolve(url: string, alt: string): Promise<{ id: number; url: string } | null> {
    if (!isExternal(url)) return null;
    const cached = await opts.lookup(url);
    if (cached) return { id: cached.wp_media_id, url: cached.wp_url };
    const r = await opts.upload(url, alt);
    uploaded++;
    return { id: r.id, url: r.source_url };
  }
  for (const url of extractImageUrls(opts.html)) {
    const r = await resolve(url, alts[url] ?? "");
    if (r) map[url] = r.url;
  }
  let featuredId: number | null = null;
  if (opts.featured?.url) {
    const r = await resolve(opts.featured.url, opts.featured.alt ?? "");
    featuredId = r?.id ?? null;
  }
  return { html: rewriteImageUrls(opts.html, map), featuredId, uploaded };
}

export function buildPostPayload(a: ArticleLike, o: { html: string; featuredId: number | null; helperInstalled: boolean; suffix: string | null }): WpPostPayload {
  const p: WpPostPayload = {
    title: a.title, slug: a.slug, content: o.html, excerpt: a.excerpt ?? undefined, status: "draft",
    categories: a.categories.map((c) => c.id), tags: a.tags.map((t) => t.id),
    featured_media: o.featuredId ?? undefined,
  };
  if (o.helperInstalled) {
    p.meta = { _yoast_wpseo_title: finalSeoTitle(a.seo_title, a.title, o.suffix), _yoast_wpseo_metadesc: a.meta_description ?? "", _yoast_wpseo_focuskw: a.primary_keyword ?? "" };
  }
  return p;
}

export function buildPublishPayload(dateIso?: string): Partial<WpPostPayload> {
  if (!dateIso) return { status: "publish" };
  return { status: "future", date_gmt: dateIso.replace(/\.\d{3}Z$/, "").replace(/Z$/, "") };
}
```

Note: `rehostImages` must upload the featured image even when the same URL appears in the body; `resolve` calls `lookup` first, so the second call is served from the map insert done by the action layer between calls — to keep it pure, keep an in-memory `seen` map inside `rehostImages` so a URL is uploaded once per run.

- [ ] **Step 3: `schema.ts`** — zod object per the interface; `slug` regex; `secondary_keywords` from comma list; `parseArticleForm`. Test: normalises blanks to null, rejects bad slug, caps `secondary_keywords` at 20.

- [ ] **Step 4:** run tests, commit `feat(articles): pure push/publish builders and form schema`.

---

### Task 5: Queries, actions (save, push, publish, sync, archive), terms

**Files:**
- Create: `src/lib/articles/queries.ts`, `src/lib/articles/actions.ts`, `src/lib/wordpress/terms.ts`

**Interfaces:**
- `listArticles({ brandId, status? })`, `getArticle(id)` → `Article` row with `brand: { slug, name, timezone, seo_suffix, website_url }`.
- `getWpTerms(brandId, { refresh?: boolean })` → `{ categories: TermRef[]; tags: TermRef[]; fetched_at: string }` cached in `brand_connections.config.wp_terms` (admin client).
- Actions (`ActionResult`): `saveArticle(prev, formData)`, `pushArticle(id)` → `{ ok, warnings: string[] }`, `publishArticle(id, dateLocal?: string)`, `syncArticle(id)`, `archiveArticle(id)`, `refreshTerms(brandId)`.

- [ ] **Step 1: `pushArticle` core** (in `actions.ts`, server):

```ts
export async function pushArticle(id: string): Promise<PushResult> {
  const r = await load(id); if (r.error) return { ok: false, error: r.error };
  const a = r.article;
  const v = validateForPush(a as ArticleLike); if (v) return { ok: false, error: v };
  const conn = await getConnectionWithSecret<WordpressConfig, WordpressSecret>(a.brand_id, "wordpress");
  if (!conn) return { ok: false, error: "WordPress is not connected for this brand" };
  const client = createWpClient(conn.config, conn.secret);
  const helper = await checkHelper(client);
  const admin = createAdminSupabase();
  const warnings: string[] = [];
  const md = metaDescriptionWarning(a.meta_description); if (md) warnings.push(md);
  if (!helper.installed) warnings.push("JamSam helper plugin not installed on this site: Yoast fields were not set");
  try {
    const rehosted = await rehostImages({
      html: a.content_html, featured: a.featured_media as MediaItem | null, siteHost: new URL(client.siteUrl).hostname,
      lookup: async (url) => (await admin.from("article_media_map").select("wp_media_id,wp_url").eq("brand_id", a.brand_id).eq("source_url", url).maybeSingle()).data,
      upload: async (url, alt) => {
        const up = await uploadMediaFromUrl(client, url, { alt });
        await admin.from("article_media_map").upsert({ brand_id: a.brand_id, source_url: url, wp_media_id: up.id, wp_url: up.source_url }, { onConflict: "brand_id,source_url" });
        return up;
      },
    });
    const payload = buildPostPayload(a as ArticleLike, { html: rehosted.html, featuredId: rehosted.featuredId, helperInstalled: helper.installed, suffix: r.article.brand.seo_suffix });
    const res = a.wp_post_id ? await updatePost(client, a.wp_post_id, payload) : await createPost(client, payload);
    await admin.from("articles").update({
      wp_post_id: res.id, wp_link: res.link, wp_status: res.status, pushed_at: new Date().toISOString(), last_error: null,
      content_html: rehosted.html, status: a.status === "published" ? "published" : "pushed_to_wp",
    }).eq("id", id);
    refresh(id);
    return { ok: true, warnings };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("articles").update({ last_error: msg }).eq("id", id);
    return { ok: false, error: msg };
  }
}
```

`publishArticle`: requires `wp_post_id`; `dateLocal` (from `datetime-local`) → `zonedLocalToUtc(dateLocal, brand.timezone)`; `updatePost(client, wp_post_id, buildPublishPayload(iso))`; store `wp_status`, `wp_link`, `published_at` (WP `date_gmt + "Z"`), `status = "published"`. `syncArticle`: `getPost` → `wp_status/wp_link`; if `publish` → `status="published"`, `published_at`. `saveArticle`: upsert; slug uniqueness error `23505` → "That slug is already used by another article for this brand". Editing a `published` article is allowed (updates go to WP on next push).

`terms.ts`: `getWpTerms` reads `config.wp_terms` if `< 24h old` unless `refresh`; else `listTerms` twice and writes back to `config` (admin).

- [ ] **Step 2:** typecheck, commit `feat(articles): queries and push/publish/sync actions`.

---

### Task 6: Editor UI

**Files:**
- Create: `src/components/articles/editor.tsx` (Tiptap, client), `src/components/articles/article-form.tsx`, `src/components/articles/article-actions.tsx`, `src/components/articles/term-select.tsx`, `src/components/articles/status-badge.tsx`, `src/app/(app)/articles/page.tsx`, `src/app/(app)/articles/new/page.tsx`, `src/app/(app)/articles/[id]/page.tsx`
- Modify: `src/components/shell/sidebar.tsx` (Articles), `src/app/(app)/dashboard/page.tsx` + `src/lib/dashboard/queries.ts` (`article_draft_count`)

- [ ] **Step 1: Tiptap editor**

```tsx
"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function RichEditor({ value, onChange, onPickImage }: { value: string; onChange: (html: string) => void; onPickImage: () => Promise<{ url: string; alt: string } | null> }) {
  const [source, setSource] = useState(false);
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] } }), Link.configure({ openOnClick: false }), Image],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { class: "prose prose-neutral max-w-none min-h-[420px] rounded-md border p-4 focus:outline-none" } },
  });
  if (!editor) return null;
  const B = ({ label, on, active }: { label: string; on: () => void; active?: boolean }) => (
    <Button type="button" size="sm" variant={active ? "secondary" : "outline"} onClick={on}>{label}</Button>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <B label="H2" on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} />
        <B label="H3" on={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} />
        <B label="B" on={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} />
        <B label="I" on={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} />
        <B label="• List" on={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} />
        <B label="1. List" on={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} />
        <B label="Link" on={() => { const url = prompt("Link URL", editor.getAttributes("link").href ?? "https://"); if (url === null) return; if (url === "") editor.chain().focus().unsetLink().run(); else editor.chain().focus().setLink({ href: url }).run(); }} active={editor.isActive("link")} />
        <B label="Image" on={async () => { const img = await onPickImage(); if (img) editor.chain().focus().setImage({ src: img.url, alt: img.alt }).run(); }} />
        <B label={source ? "Visual" : "HTML"} on={() => { if (source) editor.commands.setContent(value); setSource(!source); }} />
      </div>
      {source ? <Textarea rows={24} className="font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} /> : <EditorContent editor={editor} />}
    </div>
  );
}
```

`onPickImage` opens the Phase 2 `MediaPicker` dialog in single-pick mode: add an optional `pickOne?: (item: MediaItem) => void` prop to `MediaPicker` that, when set, hides the current-selection strip and calls back on click. (Modify `src/components/posts/media-picker.tsx` accordingly.)

- [ ] **Step 2: Form** — two-column layout as in the spec; state mirrors `articleFormSchema`; hidden `payload`; slug auto from title until touched (reuse `slugify` from `lib/brands/schema`); SEO panel shows `finalSeoTitle(...)` preview + length and `metaDescriptionWarning(...)` live; `TermSelect` is a checkbox list with a search box and a "Refresh from WordPress" button calling `refreshTerms(brandId)`.

- [ ] **Step 3: Actions bar** — buttons per status: Save (always), Push to WordPress (draft/pushed/published; confirm when re-pushing a published one), Publish (pushed_to_wp; dialog with optional `datetime-local` "Schedule for"), Sync from WP (has wp_post_id), Open in wp-admin (link), Archive. Push result toasts warnings individually.

- [ ] **Step 4: Pages** — list with filters (All/Drafts/Pushed/Published/Archived), rows show title, slug, status badge, WP link, updated time; new/edit pages load brand, media assets, terms (`getWpTerms`, tolerate WP not connected → empty lists + notice).

- [ ] **Step 5:** sidebar + dashboard count; typecheck/lint; Playwright: create article → save → appears in list → archive (no WP needed). Commit `feat(articles): Tiptap editor, form, list, actions`.

---

### Task 7: Live verification, deploy, merge

- [ ] **Step 1:** User provides a WordPress site URL + Application Password. Connect it on a brand; connection test shows helper "not installed". Download the helper zip from the app, install on WP, re-test → "installed".
- [ ] **Step 2:** Create an article with a featured image and 2 body images from the media library, categories, SEO fields → Push → verify in wp-admin: draft exists, images in Media Library, Yoast fields filled. Edit → Push again → no duplicate media (map cache). Publish (now) → live link works; Publish with a future date on a second article → WP shows "Scheduled".
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test && npm run e2e`; deploy `npx vercel deploy --prod --yes`; PR → CI → squash merge.
