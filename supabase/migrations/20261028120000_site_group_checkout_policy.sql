begin;
set local lock_timeout='2s';
set local statement_timeout='15s';

create table public.site_group_checkout_config (
  grupo_id integer primary key references public.produtogrupo(id) on delete cascade,
  policy jsonb not null default '{}'::jsonb check (jsonb_typeof(policy)='object'),
  updated_at timestamptz not null default now()
);
alter table public.site_group_checkout_config enable row level security;
revoke all on public.site_group_checkout_config from public,anon,authenticated;
grant all on public.site_group_checkout_config to service_role;

-- Existing product rules remain explicit overrides. New inheritance is opt-in
-- for these rows, while products without a row automatically inherit a group.
alter table public.site_product_checkout_config
  add column payment_override boolean not null default true;
commit;
