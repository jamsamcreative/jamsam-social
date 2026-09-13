insert into brands (slug, name, website_url, timezone, seo_suffix)
values ('jamsam-digital', 'JamSam Digital', 'https://jamsamdigital.com', 'America/Los_Angeles', ' | JamSam Digital')
on conflict (slug) do nothing;
