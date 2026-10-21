-- Armazena somente tokens e dados mascarados de cartões tokenizados pelo Asaas.
-- Nunca armazene número completo ou CVV nesta tabela.

create table if not exists public.customer_payment_card (
  id uuid primary key default gen_random_uuid(),
  cliente_id bigint not null references public.cliente(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'ASAAS' check (provider = 'ASAAS'),
  provider_customer_id text not null,
  provider_card_token text not null,
  brand text not null default 'CARTAO',
  last_four text not null check (last_four ~ '^[0-9]{4}$'),
  holder_name text not null,
  expiry_month text not null check (expiry_month ~ '^(0[1-9]|1[0-2])$'),
  expiry_year text not null check (expiry_year ~ '^[0-9]{4}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cliente_id, provider_card_token)
);

create index if not exists customer_payment_card_user_idx
  on public.customer_payment_card (user_id, created_at desc);

alter table public.customer_payment_card enable row level security;
revoke all on public.customer_payment_card from public, anon, authenticated;
grant all on public.customer_payment_card to service_role;

comment on table public.customer_payment_card is
  'Referências tokenizadas do Asaas. Não contém número completo nem CVV.';
