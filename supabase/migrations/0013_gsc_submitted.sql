-- Set when a person has pasted the article URL into Google Search Console and requested indexing.
alter table articles add column gsc_submitted_at timestamptz;
