begin;
-- Reversao do experimento de reservas; nao altera quantidades de estoque.
do $$
declare used boolean;
begin
 if to_regclass('public.site_stock_reservation') is not null then
  execute 'select exists(select 1 from public.site_stock_reservation)' into used;
  if used then raise exception 'Existem reservas registradas. Reconciliar antes da reversao.'; end if;
 end if;
 if to_regprocedure('public.fn_importar_pedido_site_sem_reserva(integer,jsonb)') is not null then
  drop function public.fn_importar_pedido_site(integer,jsonb);
  alter function public.fn_importar_pedido_site_sem_reserva(integer,jsonb) rename to fn_importar_pedido_site;
 end if;
end $$;
revoke all on function public.fn_importar_pedido_site(integer,jsonb) from public,anon,authenticated;
grant execute on function public.fn_importar_pedido_site(integer,jsonb) to service_role;
drop trigger if exists guard_site_stock_reservation on public.produto;
drop function if exists public.fn_guard_site_stock_reservation();
drop function if exists public.fn_site_stock_reserve(integer,bigint,jsonb,integer);
drop function if exists public.fn_site_stock_release(integer,bigint);
drop function if exists public.fn_site_stock_available(integer,integer[]);
drop table if exists public.site_stock_reservation;
commit;
