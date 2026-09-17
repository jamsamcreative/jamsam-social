-- supabase/migrations/0012_internal_links.sql
-- Phase 8: Internal Links — site content, link graph, suggestions

alter table site_pages add column content_text text;          -- body as plain text (for phrase search)
alter table site_pages add column content_hash text;          -- sha1 of content_text; skip re-matching when unchanged
alter table site_pages add column word_count int;

-- Rebuilt on every scan: one row per internal body link
create table site_links (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  from_page_id uuid not null references site_pages(id) on delete cascade,
  to_page_id   uuid not null references site_pages(id) on delete cascade,
  href         text not null,
  anchor_text  text not null default '',
  scanned_at   timestamptz not null default now()
);
create index site_links_to on site_links (brand_id, to_page_id);
create index site_links_from on site_links (brand_id, from_page_id);

create type link_suggestion_status as enum ('pending','approved','rejected','undone','stale','none');

-- One row per orphan per scan outcome. host_page_id null + status 'none' = orphan with no suggestion.
create table link_suggestions (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references brands(id) on delete cascade,
  orphan_page_id uuid not null references site_pages(id) on delete cascade,
  host_page_id   uuid references site_pages(id) on delete cascade,
  phrase         text,                                        -- exact words in the host to wrap
  context        text,                                        -- the sentence containing the phrase, for the card
  status         link_suggestion_status not null default 'pending',
  reason         text,                                        -- for 'none': why nothing could be proposed
  phrases_tried  text[] not null default '{}',
  href           text,                                        -- orphan url written into the host
  undo_snippet   text,                                        -- exact <a …>phrase</a> that was written
  applied_at     timestamptz,
  applied_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger link_suggestions_updated_at before update on link_suggestions for each row execute function set_updated_at();
create index link_suggestions_brand_status on link_suggestions (brand_id, status);
-- A rejected (orphan, host, phrase) triple is never re-proposed.
create unique index link_suggestions_unique_pending on link_suggestions (brand_id, orphan_page_id) where status = 'pending';

alter table site_links enable row level security;
alter table link_suggestions enable row level security;
create policy "authenticated read" on site_links for select to authenticated using (true);
create policy "authenticated read" on link_suggestions for select to authenticated using (true);
