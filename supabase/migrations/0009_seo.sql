create type keyword_source as enum ('csv','semrush','gsc','manual');
alter type job_type add value if not exists 'seo_cluster';
alter type metric_source add value if not exists 'gsc_query_page';

create table site_pages (
  id                 uuid primary key default gen_random_uuid(),
  brand_id           uuid not null references brands(id) on delete cascade,
  wp_id              int not null,
  type               text not null,
  slug               text not null,
  url                text not null,
  title              text not null,
  excerpt            text,
  focus_keyword      text,
  featured_image_url text,
  modified_at        timestamptz,
  mirrored_at        timestamptz not null default now(),
  unique (brand_id, type, wp_id)
);
create index site_pages_brand_slug on site_pages (brand_id, slug);

create table keywords (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references brands(id) on delete cascade,
  keyword             text not null,
  cluster             text,
  volume              int,
  difficulty          int,
  intent              text,
  competitor          text,
  competitor_position int,
  our_position        numeric(5,1),
  our_impressions     int,
  our_clicks          int,
  our_page            text,
  source              keyword_source not null default 'csv',
  notes               text,
  imported_at         timestamptz not null default now(),
  refreshed_at        timestamptz,
  unique (brand_id, keyword)
);
create index keywords_brand_cluster on keywords (brand_id, cluster);

create table projects (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  external_id  text,
  title        text not null,
  url          text,
  category     text,
  location     text,
  state        text,
  dims         text,
  description  text,
  images       jsonb not null default '[]'::jsonb,
  tags         text[] not null default '{}',
  search       tsvector generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(location,'') || ' ' || coalesce(category,'') || ' ' || coalesce(dims,''))) stored,
  imported_at  timestamptz not null default now(),
  unique (brand_id, url)
);
create index projects_search on projects using gin (search);
create index projects_brand_category on projects (brand_id, category);

create table keyword_imports (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references brands(id) on delete cascade,
  kind       text not null,
  detail     text,
  rows       int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index keyword_imports_brand on keyword_imports (brand_id, created_at desc);

alter table site_pages      enable row level security;
alter table keywords        enable row level security;
alter table projects        enable row level security;
alter table keyword_imports enable row level security;
create policy "authenticated full access" on site_pages      for all to authenticated using (true) with check (true);
create policy "authenticated full access" on keywords        for all to authenticated using (true) with check (true);
create policy "authenticated full access" on projects        for all to authenticated using (true) with check (true);
create policy "authenticated full access" on keyword_imports for all to authenticated using (true) with check (true);
