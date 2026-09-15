-- supabase/migrations/0011_weekly_plan.sql
-- Phase 7: Weekly Plan — schedules, imported social history, planner provenance.

create table brand_schedules (
  brand_id           uuid primary key references brands(id) on delete cascade,
  slots              jsonb not null default '[]'::jsonb,   -- [{dow:0-6, platform:'facebook'|'instagram', time:'15:30'}]
  recycle_cap        int  not null default 3,
  rest_days_min      int  not null default 60,
  rest_days_max      int  not null default 90,
  history_synced_at  timestamptz,
  history_cursor     jsonb,                                -- {facebook: next_url|null, instagram: next_url|null}
  updated_at         timestamptz not null default now()
);
create trigger brand_schedules_updated_at before update on brand_schedules for each row execute function set_updated_at();

create table social_history (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  platform      social_platform not null,
  external_id   text not null,
  published_at  timestamptz not null,
  caption       text not null default '',
  media         jsonb not null default '[]'::jsonb,        -- [{url, kind:'image'|'video'|'carousel'}]
  permalink     text,
  likes         int not null default 0,
  comments      int not null default 0,
  shares        int not null default 0,
  reach         int,
  interactions  int generated always as (likes + comments + shares) stored,
  post_id       uuid references posts(id) on delete set null,
  fetched_at    timestamptz not null default now(),
  unique (brand_id, platform, external_id)
);
create index social_history_brand_published on social_history (brand_id, published_at desc);

alter table posts add column project_id uuid references projects(id) on delete set null;
create index posts_project on posts (project_id) where project_id is not null;
alter table posts add column plan jsonb;
-- plan: {week_start:'YYYY-MM-DD', lane:'new_page'|'recycle'|'promo'|'filler', reason:text, candidate_id:text, touched:boolean}

create table plan_weeks (
  brand_id       uuid not null references brands(id) on delete cascade,
  week_start     date not null,
  built_at       timestamptz not null default now(),
  built_by       text not null,
  timing_source  text not null,
  skipped        jsonb not null default '[]'::jsonb,
  summary        jsonb not null,
  primary key (brand_id, week_start)
);

alter table brand_schedules enable row level security;
alter table social_history  enable row level security;
alter table plan_weeks      enable row level security;
create policy "authenticated read" on brand_schedules for select to authenticated using (true);
create policy "authenticated read" on social_history  for select to authenticated using (true);
create policy "authenticated read" on plan_weeks      for select to authenticated using (true);

-- Build next week every Monday 13:00 UTC (~06:00 Pacific). Route only creates drafts / pending approval.
select cron.schedule(
  'jamsam-plan-weekly',
  '0 13 * * 1',
  $$
  select net.http_post(
    url := (select value from public.app_settings where key = 'cron_url') || '/api/cron/plan',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select value from public.app_settings where key = 'cron_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
