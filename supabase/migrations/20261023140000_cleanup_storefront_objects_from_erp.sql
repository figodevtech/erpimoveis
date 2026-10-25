begin;

set local lock_timeout = '2s';
set local statement_timeout = '15s';

-- Remove only standalone storefront objects accidentally added to an ERP.
-- ERP routines take integer IDs; storefront overloads take bigint IDs.
-- No CASCADE: an unexpected dependency must stop this cleanup.
do $$
begin
  if to_regclass('public.site_order_link') is null
     or to_regprocedure('public.fn_criar_pedido_site(integer,jsonb,jsonb,numeric,numeric,text,text)') is null
     or to_regclass('public.checkout_attempt') is not null then
    raise exception 'ERP schema required; never apply this migration to a storefront database';
  end if;
end $$;

drop function if exists public.fn_criar_pedido_site(bigint,jsonb,jsonb,numeric,numeric,text,text);
drop function if exists public.fn_baixar_estoque_venda(bigint);
drop function if exists public.fn_estornar_estoque_venda(bigint);

drop table if exists public.payment_webhook_event;
drop table if exists public.produto_compatibilidade;
drop table if exists public.veiculo_compatibilidade;
drop table if exists public.store_payment_config;

do $$
begin
if exists (
  select 1 from pg_attribute
  where attrelid = 'public.venda'::regclass and not attisdropped
    and attname = any(array['enviado_em','estoque_baixado','faturado_em',
      'gateway_checkout_url','gateway_due_date','gateway_payment_id','gateway_status',
      'payment_provider','transportadora','url_rastreio'])
) then
alter table public.venda
  drop column if exists enviado_em,
  drop column if exists estoque_baixado,
  drop column if exists faturado_em,
  drop column if exists gateway_checkout_url,
  drop column if exists gateway_due_date,
  drop column if exists gateway_payment_id,
  drop column if exists gateway_status,
  drop column if exists payment_provider,
  drop column if exists transportadora,
  drop column if exists url_rastreio;
end if;
end $$;

commit;
