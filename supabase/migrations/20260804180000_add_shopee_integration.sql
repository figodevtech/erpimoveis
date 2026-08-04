create table if not exists public.shopee_account (
  id bigserial primary key,
  empresa_id integer not null references public.empresa(id) on delete cascade,
  shop_id bigint not null,
  shop_name text,
  region text not null default 'BR',
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz,
  raw_token jsonb not null default '{}'::jsonb,
  raw_shop jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id),
  unique (shop_id)
);

create table if not exists public.shopee_product_link (
  id bigserial primary key,
  empresa_id integer not null references public.empresa(id) on delete cascade,
  produto_id integer not null references public.produto(id) on delete cascade,
  item_id bigint not null,
  model_id bigint,
  item_sku text,
  model_sku text,
  title text,
  status text,
  raw_item jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, produto_id),
  unique nulls not distinct (item_id, model_id)
);

create table if not exists public.shopee_order (
  id bigserial primary key,
  empresa_id integer not null references public.empresa(id) on delete cascade,
  account_id bigint references public.shopee_account(id) on delete set null,
  venda_id integer references public.venda(id) on delete set null,
  order_sn text not null,
  status text,
  buyer_user_id bigint,
  buyer_username text,
  currency text,
  total_amount numeric,
  payment_method text,
  tracking_number text,
  shipping_carrier text,
  create_time timestamptz,
  update_time timestamptz,
  import_status text not null default 'PENDENTE',
  import_locked_at timestamptz,
  import_error text,
  raw_order jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, order_sn)
);

create index if not exists idx_shopee_order_account_updated on public.shopee_order(account_id, update_time desc);
create index if not exists idx_shopee_order_import on public.shopee_order(import_status, import_locked_at);
create index if not exists idx_shopee_product_link_item on public.shopee_product_link(item_id, model_id);

alter table public.shopee_account enable row level security;
alter table public.shopee_product_link enable row level security;
alter table public.shopee_order enable row level security;

create or replace function public.fn_reservar_importacao_shopee(
  p_order_sn text,
  p_empresa_id integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  update public.shopee_order
     set import_status = 'PROCESSANDO',
         import_locked_at = now(),
         import_error = null,
         updated_at = now()
   where order_sn = p_order_sn
     and empresa_id = p_empresa_id
     and venda_id is null
     and (
       import_status in ('PENDENTE', 'ERRO')
       or (import_status = 'PROCESSANDO' and (import_locked_at is null or import_locked_at < now() - interval '10 minutes'))
     );
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.fn_reservar_importacao_shopee(text, integer) from public;
grant execute on function public.fn_reservar_importacao_shopee(text, integer) to service_role;

create or replace function public.fn_criar_venda_shopee_reservada(
  p_order_sn text,
  p_empresa_id integer,
  p_venda jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda_id integer;
  v_import_status text;
begin
  select venda_id, import_status
    into v_venda_id, v_import_status
    from public.shopee_order
   where order_sn = p_order_sn and empresa_id = p_empresa_id
   for update;

  if not found then raise exception 'Pedido Shopee % não encontrado.', p_order_sn; end if;
  if v_venda_id is not null then return v_venda_id; end if;
  if v_import_status <> 'PROCESSANDO' then raise exception 'Pedido Shopee % não está reservado para importação.', p_order_sn; end if;

  v_venda_id := public.fn_criar_venda_marketplace_com_itens(p_venda);
  update public.shopee_order
     set venda_id = v_venda_id,
         import_status = 'IMPORTADA',
         import_locked_at = null,
         import_error = null,
         updated_at = now()
   where order_sn = p_order_sn and empresa_id = p_empresa_id;
  return v_venda_id;
end;
$$;

revoke all on function public.fn_criar_venda_shopee_reservada(text, integer, jsonb) from public;
grant execute on function public.fn_criar_venda_shopee_reservada(text, integer, jsonb) to service_role;
