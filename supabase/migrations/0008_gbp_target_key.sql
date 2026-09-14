-- ON CONFLICT needs a real unique constraint; the expression index from 0007 cannot be targeted by upserts.
drop index if exists post_targets_post_platform_loc;
update post_targets set location_ref = '' where location_ref is null;
alter table post_targets alter column location_ref set default '';
alter table post_targets alter column location_ref set not null;
alter table post_targets add constraint post_targets_post_platform_location_key unique (post_id, platform, location_ref);
