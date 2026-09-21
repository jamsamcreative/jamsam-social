-- Per-brand identifiers for SEO tools Claude uses via its own MCP connectors (Local Falcon place ID +
-- keywords, Ahrefs target domain / project). Reference only: no keys, nothing synced.
alter table brands add column seo_tools jsonb not null default '{}'::jsonb;
