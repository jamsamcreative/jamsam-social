-- OAuth 2.1 authorization server for the MCP endpoint (Claude.ai custom connectors).
-- Service-role only: RLS enabled with no policies, so the anon/authenticated roles see nothing.
create table oauth_clients (
  id             uuid primary key default gen_random_uuid(),
  client_id      text not null unique,
  client_name    text,
  redirect_uris  text[] not null,
  created_at     timestamptz not null default now()
);

create table oauth_codes (
  code_hash       text primary key,
  client_id       text not null references oauth_clients(client_id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  redirect_uri    text not null,
  code_challenge  text not null,
  scope           text,
  resource        text,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

create table oauth_tokens (
  id                  uuid primary key default gen_random_uuid(),
  client_id           text not null references oauth_clients(client_id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  access_token_hash   text not null unique,
  refresh_token_hash  text not null unique,
  scope               text,
  access_expires_at   timestamptz not null,
  refresh_expires_at  timestamptz not null,
  revoked_at          timestamptz,
  last_used_at        timestamptz,
  created_at          timestamptz not null default now()
);
create index oauth_tokens_user_idx on oauth_tokens (user_id, created_at desc);

alter table oauth_clients enable row level security;
alter table oauth_codes   enable row level security;
alter table oauth_tokens  enable row level security;
