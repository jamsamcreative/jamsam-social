-- Google Business Profile posting target (feature-flagged in the app).
alter type social_platform add value if not exists 'gbp';
-- One GBP target per location: relax the (post_id, platform) uniqueness for gbp by keying on external_ref.
alter table post_targets add column if not exists location_ref text;
alter table post_targets drop constraint if exists post_targets_post_id_platform_key;
create unique index if not exists post_targets_post_platform_loc on post_targets (post_id, platform, coalesce(location_ref, ''));
