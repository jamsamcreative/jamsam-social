alter type connection_provider add value if not exists 'google_analytics';
alter type connection_provider add value if not exists 'search_console';
alter type connection_provider add value if not exists 'meta_ads';
alter type connection_provider add value if not exists 'gbp';

create type metric_source as enum (
  'ga4_channel','ga4_campaign','ga4_total',
  'gsc_total','gsc_query','gsc_page',
  'meta_ads_campaign','meta_ads_total'
);

create table metrics_daily (
  brand_id   uuid not null references brands(id) on delete cascade,
  source     metric_source not null,
  date       date not null,
  dim        text not null,
  metrics    jsonb not null,
  extra      jsonb,
  synced_at  timestamptz not null default now(),
  primary key (brand_id, source, date, dim)
);
create index metrics_daily_brand_source_date on metrics_daily (brand_id, source, date desc);

create table sync_runs (
  brand_id     uuid not null references brands(id) on delete cascade,
  source       text not null,
  last_run_at  timestamptz,
  last_ok_at   timestamptz,
  last_error   text,
  backfilled   boolean not null default false,
  primary key (brand_id, source)
);

alter table metrics_daily enable row level security;
alter table sync_runs     enable row level security;
create policy "authenticated read" on metrics_daily for select to authenticated using (true);
create policy "authenticated read" on sync_runs     for select to authenticated using (true);

-- Nightly marketing-data sync (11:00 UTC ≈ 04:00 Pacific)
select cron.schedule(
  'jamsam-metrics-daily',
  '0 11 * * *',
  $$
  select net.http_post(
    url := (select value from public.app_settings where key = 'cron_url') || '/api/cron/metrics',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select value from public.app_settings where key = 'cron_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
