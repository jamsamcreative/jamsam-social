create type post_status     as enum ('draft','pending_approval','approved','publishing','published','failed','archived');
create type post_source     as enum ('manual','recycled','ai');
create type social_platform as enum ('facebook','instagram');
create type target_status   as enum ('pending','publishing','published','failed');

create table posts (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  title         text not null,
  link_url      text,
  media         jsonb not null default '[]'::jsonb,
  source        post_source not null default 'manual',
  recycled_from uuid references posts(id) on delete set null,
  status        post_status not null default 'draft',
  created_by    uuid references auth.users(id),
  approved_by   uuid references auth.users(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index posts_brand_status_idx on posts (brand_id, status, created_at desc);
create trigger posts_updated_at before update on posts for each row execute function set_updated_at();

create table post_targets (
  id                  uuid primary key default gen_random_uuid(),
  post_id             uuid not null references posts(id) on delete cascade,
  platform            social_platform not null,
  caption             text not null default '',
  scheduled_at        timestamptz,
  status              target_status not null default 'pending',
  external_id         text,
  external_url        text,
  published_at        timestamptz,
  error               text,
  attempts            int not null default 0,
  claimed_at          timestamptz,
  insights            jsonb,
  insights_fetched_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (post_id, platform)
);
create index post_targets_due_idx on post_targets (status, scheduled_at) where status = 'pending';
create trigger post_targets_updated_at before update on post_targets for each row execute function set_updated_at();

alter table posts        enable row level security;
alter table post_targets enable row level security;
create policy "authenticated full access" on posts        for all to authenticated using (true) with check (true);
create policy "authenticated full access" on post_targets for all to authenticated using (true) with check (true);

-- Server-only key/value settings (no policies: only service role / superuser can read)
create table app_settings (
  key   text primary key,
  value text not null
);
alter table app_settings enable row level security;

-- Atomically claim due targets so concurrent cron runs never double-publish.
create or replace function claim_due_targets(max_rows int default 10)
returns setof post_targets language sql security definer set search_path = public as $$
  with due as (
    select t.id
    from post_targets t
    join posts p on p.id = t.post_id
    where t.status = 'pending'
      and t.scheduled_at is not null
      and t.scheduled_at <= now()
      and p.status in ('approved','publishing')
      and t.attempts < 3
    order by t.scheduled_at
    limit max_rows
    for update of t skip locked
  )
  update post_targets t
  set status = 'publishing', claimed_at = now(), attempts = attempts + 1
  from due
  where t.id = due.id
  returning t.*;
$$;

-- A run that crashed leaves rows in 'publishing'; give them back after 10 minutes.
create or replace function reset_stale_targets()
returns int language sql security definer set search_path = public as $$
  with r as (
    update post_targets
    set status = 'pending', claimed_at = null
    where status = 'publishing' and claimed_at < now() - interval '10 minutes'
    returning 1
  )
  select count(*)::int from r;
$$;

-- Cron triggers (URL and secret come from app_settings, seeded outside this file)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'jamsam-publish-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select value from public.app_settings where key = 'cron_url') || '/api/cron/publish',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select value from public.app_settings where key = 'cron_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'jamsam-insights-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url := (select value from public.app_settings where key = 'cron_url') || '/api/cron/insights',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select value from public.app_settings where key = 'cron_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
