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
