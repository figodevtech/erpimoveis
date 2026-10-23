begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

-- Vehicle compatibility is deferred until a shared ERP/storefront feature exists.
-- Never cascade into products, orders, payments or other business records.
do $$
begin
  if to_regclass('public.checkout_attempt') is null
     or to_regclass('public.site_order_link') is not null then
    raise exception 'This migration must run only in a storefront database';
  end if;
end $$;
drop table if exists public.produto_compatibilidade;
drop table if exists public.veiculo_compatibilidade;
commit;
