create table if not exists public.store_payment_config (
  id boolean primary key default true check (id = true),
  central_installation_id text,
  store_name text not null default 'Loja virtual',
  enabled boolean not null default true,
  commission_enabled boolean not null default false,
  commission_percent numeric(7,4) not null default 0,
  commission_wallet_id text,
  revision integer not null default 0,
  effective_at timestamptz,
  central_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  constraint store_payment_config_percent_check
    check (commission_percent >= 0 and commission_percent < 100),
  constraint store_payment_config_commission_check check (
    commission_enabled = false
    or (commission_percent > 0 and nullif(trim(commission_wallet_id), '') is not null)
  )
);

insert into public.store_payment_config (id)
values (true)
on conflict (id) do nothing;

alter table public.venda
  add column if not exists commission_config_revision integer not null default 0,
  add column if not exists commission_wallet_id text;

alter table public.store_payment_config enable row level security;
revoke all on public.store_payment_config from public, anon, authenticated;
grant all on public.store_payment_config to service_role;

comment on table public.store_payment_config is
  'Cópia local resiliente da configuração financeira publicada pela Central.';
