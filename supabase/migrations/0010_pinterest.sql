create type pin_status as enum ('draft','pending_approval','approved','publishing','published','failed','archived');
alter type job_type add value if not exists 'pin';

create table pin_boards (
  brand_id   uuid not null references brands(id) on delete cascade,
  board_id   text not null,
  name       text not null,
  privacy    text,
  pin_count  int,
  synced_at  timestamptz not null default now(),
  primary key (brand_id, board_id)
);

create table pins (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references brands(id) on delete cascade,
  board_id            text not null,
  board_name          text,
  title               text not null,
  description         text not null,
  link                text,
  alt_text            text,
  image_url           text not null,
  media_asset_id      uuid references media_assets(id) on delete set null,
  project_id          uuid references projects(id) on delete set null,
  source              post_source not null default 'manual',
  status              pin_status not null default 'draft',
  scheduled_at        timestamptz,
  published_at        timestamptz,
  external_id         text,
  external_url        text,
  error               text,
  attempts            int not null default 0,
  claimed_at          timestamptz,
  insights            jsonb,
  insights_fetched_at timestamptz,
  created_by          uuid references auth.users(id),
  approved_by         uuid references auth.users(id),
  approved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index pins_brand_status on pins (brand_id, status, scheduled_at);
create trigger pins_updated_at before update on pins for each row execute function set_updated_at();

alter table pin_boards enable row level security;
alter table pins       enable row level security;
create policy "authenticated full access" on pin_boards for all to authenticated using (true) with check (true);
create policy "authenticated full access" on pins       for all to authenticated using (true) with check (true);

create or replace function claim_due_pins(max_rows int default 10)
returns setof pins language sql security definer set search_path = public as $$
  with due as (
    select id from pins
    where status = 'approved' and scheduled_at is not null and scheduled_at <= now() and attempts < 3
    order by scheduled_at limit max_rows
    for update skip locked
  )
  update pins p set status = 'publishing', claimed_at = now(), attempts = attempts + 1
  from due where p.id = due.id
  returning p.*;
$$;

create or replace function reset_stale_pins()
returns int language sql security definer set search_path = public as $$
  with r as (
    update pins set status = 'approved', claimed_at = null
    where status = 'publishing' and claimed_at < now() - interval '10 minutes'
    returning 1
  )
  select count(*)::int from r;
$$;
