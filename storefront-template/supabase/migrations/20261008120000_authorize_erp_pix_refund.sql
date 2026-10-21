begin;
create table if not exists public.site_order_refund_authorization (
  operation_id text primary key,
  order_id bigint not null references public.venda(id),
  payment_id text not null,
  requested_at timestamptz not null,
  amount numeric(14,2) not null check (amount > 0),
  approved_at timestamptz not null default now(),
  unique(order_id, requested_at)
);
alter table public.site_order_refund_authorization enable row level security;
revoke all on public.site_order_refund_authorization from public,anon,authenticated;
grant all on public.site_order_refund_authorization to service_role;

create or replace function public.fn_autorizar_estorno_pix_erp(
  p_operation_id text, p_order_id bigint, p_payment_id text,
  p_amount numeric, p_operation_created_at timestamptz
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_request public.site_order_refund_request%rowtype; v_sale public.venda%rowtype;
begin
  if nullif(trim(p_operation_id),'') is null or p_amount <= 0 or p_operation_created_at is null then return false; end if;
  select * into v_request from public.site_order_refund_request
    where order_id=p_order_id and payment_id=p_payment_id for update;
  if not found or v_request.denied_at is not null or p_operation_created_at < v_request.created_at - interval '2 seconds' then return false; end if;
  select * into v_sale from public.venda where id=p_order_id for update;
  if not found or v_sale.canal::text <> 'ONLINE' or v_sale.status::text <> 'PAGO'
     or v_sale.payment_provider <> 'ASAAS' or v_sale.gateway_payment_id <> p_payment_id
     or v_sale.valortotal <> p_amount or coalesce(v_sale.status_entrega::text,'') in ('ENVIADO','ENTREGUE')
     or v_sale.enviado_em is not null or v_sale.entregue_em is not null then return false; end if;
  if exists(select 1 from public.site_order_refund_authorization where operation_id=p_operation_id) then
    return exists(select 1 from public.site_order_refund_authorization where operation_id=p_operation_id
      and order_id=p_order_id and payment_id=p_payment_id and requested_at=v_request.created_at and amount=p_amount);
  end if;
  if exists(select 1 from public.site_order_refund_authorization where order_id=p_order_id and requested_at=v_request.created_at) then return false; end if;
  insert into public.site_order_refund_authorization(operation_id,order_id,payment_id,requested_at,amount)
    values(p_operation_id,p_order_id,p_payment_id,v_request.created_at,p_amount);
  return true;
end;
$$;
revoke all on function public.fn_autorizar_estorno_pix_erp(text,bigint,text,numeric,timestamptz) from public,anon,authenticated;
grant execute on function public.fn_autorizar_estorno_pix_erp(text,bigint,text,numeric,timestamptz) to service_role;
commit;
