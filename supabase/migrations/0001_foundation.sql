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
