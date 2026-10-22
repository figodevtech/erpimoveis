begin;
-- Older payable orders never had ERP reservations. Do not introduce new
-- reservations while that unreserved backlog can still consume the same units.
create function public.fn_checkout_cutover_status()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('pending',count(*),'withPayment',count(*) filter(where gateway_payment_id is not null))
 from public.venda where not central_inventory and status::text='PENDENTE';
$$;
do $$ declare d text; begin
 select pg_get_functiondef('public.fn_start_checkout(uuid,bigint,text,text,jsonb,jsonb,numeric,numeric,text)'::regprocedure) into d;
 if position('order_id:=public.fn_criar_pedido_site' in d)=0 then raise exception 'Unexpected checkout function. Review before deployment.'; end if;
 d:=replace(d,'order_id:=public.fn_criar_pedido_site',
  'if (public.fn_checkout_cutover_status()->>''pending'')::integer>0 then raise exception ''CHECKOUT_CUTOVER_PENDING''; end if; order_id:=public.fn_criar_pedido_site');
 execute d;
end $$;
revoke all on function public.fn_checkout_cutover_status() from public,anon,authenticated;
grant execute on function public.fn_checkout_cutover_status() to service_role;
commit;
