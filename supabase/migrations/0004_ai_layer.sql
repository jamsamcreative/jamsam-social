create type job_type   as enum ('caption','article','promo','rewrite');
create type job_status as enum ('queued','claimed','running','completed','failed');
create type job_runner as enum ('in_app','mcp');

create table generation_jobs (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  type          job_type not null,
  status        job_status not null default 'queued',
  runner        job_runner not null default 'in_app',
  input         jsonb not null,
  result        jsonb,
  error         text,
  post_id       uuid references posts(id) on delete set null,
  article_id    uuid references articles(id) on delete set null,
  claimed_by    text,
  claimed_at    timestamptz,
  started_at    timestamptz,
  finished_at   timestamptz,
  attempts      int not null default 0,
  model         text,
  input_tokens  int,
  output_tokens int,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index generation_jobs_status_idx on generation_jobs (status, created_at);
create index generation_jobs_brand_idx  on generation_jobs (brand_id, created_at desc);
create trigger generation_jobs_updated_at before update on generation_jobs for each row execute function set_updated_at();

create table post_categories (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  name         text not null,
  slug         text not null,
  target_share numeric(4,3) not null check (target_share >= 0 and target_share <= 1),
  description  text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  unique (brand_id, slug)
);
alter table posts add column category_id uuid references post_categories(id) on delete set null;

alter table generation_jobs enable row level security;
alter table post_categories enable row level security;
create policy "authenticated full access" on generation_jobs for all to authenticated using (true) with check (true);
create policy "authenticated full access" on post_categories for all to authenticated using (true) with check (true);

-- Backstop tick for in-app jobs (see /api/cron/jobs)
select cron.schedule(
  'jamsam-jobs-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select value from public.app_settings where key = 'cron_url') || '/api/cron/jobs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select value from public.app_settings where key = 'cron_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
