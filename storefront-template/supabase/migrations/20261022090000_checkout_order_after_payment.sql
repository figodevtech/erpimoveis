begin;
-- Checkout references share the order sequence, but an attempt is not a sale.
-- Gaps in that sequence are normal when a checkout is abandoned or declined.
alter table public.checkout_attempt drop constraint checkout_attempt_order_id_fkey;
alter table public.checkout_attempt add column checkout_payload jsonb not null default '{}';
alter table public.checkout_attempt add column payment_data jsonb not null default '{}';
alter table public.checkout_attempt add column payment_meta jsonb not null default '{}';

-- Preserve attempts that were already created by the previous version.
update public.checkout_attempt a set checkout_payload=jsonb_build_object(
 'address',v.endereco_entrega_snapshot,'subtotal',v.sub_total,'total',v.valortotal,'method',v.forma_pagamento,
 'items',coalesce((select jsonb_agg(jsonb_build_object('produtoid',i.produtoid,'quantidade',i.quantidade,'sub_total',i.sub_total,'valor_total',i.valor_total,'valor_desconto',i.valor_desconto,'tipo_desconto',i.tipo_desconto)) from public.vendaproduto i where i.venda_id=v.id),'[]'::jsonb)),
 payment_data=jsonb_build_object('url',v.gateway_checkout_url,'status',v.gateway_status,'dueDate',v.gateway_due_date),
 payment_meta=jsonb_build_object('commission_percent',v.commission_percent,'commission_wallet_id',v.commission_wallet_id,'commission_config_revision',v.commission_config_revision)
from public.venda v where v.id=a.order_id;

create or replace function public.fn_start_checkout(p_attempt uuid,p_cliente bigint,p_hash text,p_billing text,p_address jsonb,p_items jsonb,p_subtotal numeric,p_total numeric,p_method text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.checkout_attempt%rowtype; reference_id bigint;
begin
 if p_attempt is null or length(p_hash)<>64 or p_billing not in ('PIX','BOLETO','CREDIT_CARD') or p_cliente is null
  or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100
  or p_total is null or p_total<=0 or p_subtotal is null or p_subtotal<=0 or p_address is null
  or not exists(select 1 from public.cliente where id=p_cliente) then raise exception 'INVALID_ATTEMPT'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) i where coalesce((i->>'produtoid')::integer,0)<=0 or coalesce((i->>'quantidade')::integer,0)<=0 or coalesce((i->>'valor_total')::numeric,0)<=0) then raise exception 'INVALID_ITEMS'; end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout-attempt:'||p_attempt,0));
 perform pg_advisory_xact_lock(hashtextextended('checkout-customer:'||p_cliente,0));
 select * into r from public.checkout_attempt where attempt_id=p_attempt for update;
 if found then
  if r.cliente_id<>p_cliente or r.request_hash<>p_hash then raise exception 'ATTEMPT_CONFLICT'; end if;
  return jsonb_build_object('orderId',r.order_id,'attemptId',r.attempt_id,'started',false,'phase',r.phase);
 end if;
 select * into r from public.checkout_attempt where cliente_id=p_cliente and request_hash=p_hash and phase not in ('CANCELLED','DONE') for update;
 if found then return jsonb_build_object('orderId',r.order_id,'attemptId',r.attempt_id,'started',false,'phase',r.phase); end if;
 if (public.fn_checkout_cutover_status()->>'pending')::integer>0 then raise exception 'CHECKOUT_CUTOVER_PENDING'; end if;
 reference_id:=nextval(pg_get_serial_sequence('public.venda','id'));
 insert into public.checkout_attempt(attempt_id,cliente_id,request_hash,order_id,billing_type,checkout_payload)
 values(p_attempt,p_cliente,p_hash,reference_id,p_billing,jsonb_build_object('address',p_address,'items',p_items,'subtotal',round(p_subtotal,2),'total',round(p_total,2),'method',p_method));
 return jsonb_build_object('orderId',reference_id,'attemptId',p_attempt,'started',true,'phase','PREPARING');
end $$;

create or replace function public.fn_checkout_bind(p_order bigint,p_payment text,p_customer text,p_total numeric,p_billing text,p_due date,p_url text,p_status text)
returns boolean language plpgsql security definer set search_path=public as $$
declare r public.checkout_attempt%rowtype; sale public.venda%rowtype; i jsonb; has_sale boolean;
begin
 select * into r from public.checkout_attempt where order_id=p_order for update;
 if not found then return false; end if;
 if r.phase not in ('SENDING','BOUND','REVIEW','DONE') or r.expected_customer is distinct from p_customer
  or p_total is null or round((r.checkout_payload->>'total')::numeric,2) is distinct from round(p_total,2)
  or r.billing_type is distinct from p_billing or nullif(p_payment,'') is null
  or (r.payment_id is not null and r.payment_id<>p_payment) then raise exception 'PAYMENT_ORDER_MISMATCH'; end if;
 select * into sale from public.venda where id=p_order for update;
 has_sale:=found;
 if has_sale and (sale.clienteid<>r.cliente_id or round(sale.valortotal,2)<>round(p_total,2)) then raise exception 'ORDER_ID_CONFLICT'; end if;
 if not has_sale and p_status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH') then
  insert into public.venda(id,clienteid,status,sub_total,valortotal,forma_pagamento,endereco_entrega_snapshot,canal,central_inventory)
   values(p_order,r.cliente_id,'PENDENTE',(r.checkout_payload->>'subtotal')::numeric,(r.checkout_payload->>'total')::numeric,r.checkout_payload->>'method',r.checkout_payload->'address','ONLINE',true);
  for i in select * from jsonb_array_elements(r.checkout_payload->'items') loop
   insert into public.vendaproduto(venda_id,produtoid,quantidade,sub_total,valor_total,valor_desconto,valor_frete,tipo_desconto)
   values(p_order,(i->>'produtoid')::integer,(i->>'quantidade')::integer,(i->>'sub_total')::numeric,(i->>'valor_total')::numeric,coalesce((i->>'valor_desconto')::numeric,0),0,i->>'tipo_desconto');
  end loop;
 end if;
 update public.checkout_attempt set payment_id=p_payment,phase=case when phase='DONE' then phase else 'BOUND' end,
  payment_data=jsonb_build_object('url',p_url,'status',p_status,'dueDate',p_due),updated_at=now() where order_id=p_order;
 update public.venda set payment_provider='ASAAS',gateway_payment_id=p_payment,gateway_checkout_url=p_url,gateway_due_date=p_due,
  gateway_status=case when status::text in ('PAGO','CANCELADO') then gateway_status else p_status end,
  commission_percent=coalesce((r.payment_meta->>'commission_percent')::numeric,0),commission_wallet_id=r.payment_meta->>'commission_wallet_id',
  commission_config_revision=coalesce((r.payment_meta->>'commission_config_revision')::integer,0),updatedat=now() where id=p_order;
 return true;
end $$;
revoke all on function public.fn_start_checkout(uuid,bigint,text,text,jsonb,jsonb,numeric,numeric,text),public.fn_checkout_bind(bigint,text,text,numeric,text,date,text,text) from public,anon,authenticated;
grant execute on function public.fn_start_checkout(uuid,bigint,text,text,jsonb,jsonb,numeric,numeric,text),public.fn_checkout_bind(bigint,text,text,numeric,text,date,text,text) to service_role;
commit;
