begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
create table public.store_shipping_oauth_state (
 state_hash text primary key,
 environment text not null check(environment in ('sandbox','production')),
 client_id text not null,
 started boolean not null default false,
 expires_at timestamptz not null
);
create index store_shipping_oauth_state_expiry on public.store_shipping_oauth_state(expires_at);
create table public.store_shipping_connection (
 environment text primary key check(environment in ('sandbox','production')),
 client_id text not null,
 encrypted_tokens text not null,
 expires_at timestamptz not null,
 revision uuid not null,
 refresh_owner uuid,
 refresh_lock_until timestamptz,
 requires_reconnect boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.store_shipping_oauth_state enable row level security;
alter table public.store_shipping_connection enable row level security;
revoke all on public.store_shipping_oauth_state,public.store_shipping_connection from public,anon,authenticated;
grant all on public.store_shipping_oauth_state,public.store_shipping_connection to service_role;
commit;
