begin;
alter table public.venda add column central_inventory boolean not null default false;
create table public.checkout_attempt (
 attempt_id uuid primary key,
 cliente_id bigint not null references public.cliente(id),
 request_hash text not null,
 order_id bigint not null unique references public.venda(id),
 billing_type text not null check(billing_type in ('PIX','BOLETO','CREDIT_CARD')),
 phase text not null default 'PREPARING' check(phase in ('PREPARING','SENDING','BOUND','REVIEW','CANCELLED','DONE')),
 expected_customer text,
 payment_id text unique,
 last_error text,
 release_pending boolean not null default false,
 bank_cancelled_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 reconciled_at timestamptz not null default now()
);
create index checkout_attempt_reconcile_idx on public.checkout_attempt(reconciled_at) where phase not in ('CANCELLED','DONE') or release_pending;
create unique index checkout_attempt_active_cart_idx on public.checkout_attempt(cliente_id,request_hash) where phase not in ('CANCELLED','DONE');
alter table public.checkout_attempt enable row level security;
revoke all on public.checkout_attempt from public,anon,authenticated;
grant all on public.checkout_attempt to service_role;
create table public.checkout_gateway_event (
 event_id text primary key,
 payment_id text not null,
 event_type text not null,
 received_at timestamptz not null default now(),
 processed_at timestamptz
);
create index checkout_gateway_event_pending_idx on public.checkout_gateway_event(received_at) where processed_at is null;
alter table public.checkout_gateway_event enable row level security;
revoke all on public.checkout_gateway_event from public,anon,authenticated;
grant all on public.checkout_gateway_event to service_role;

create function public.fn_start_checkout(p_attempt uuid,p_cliente bigint,p_hash text,p_billing text,p_address jsonb,p_items jsonb,p_subtotal numeric,p_total numeric,p_method text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.checkout_attempt%rowtype; order_id bigint;
begin
 if p_attempt is null or length(p_hash)<>64 or p_billing not in ('PIX','BOLETO','CREDIT_CARD') then raise exception 'INVALID_ATTEMPT'; end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout-attempt:'||p_attempt,0));
 perform pg_advisory_xact_lock(hashtextextended('checkout-customer:'||p_cliente,0));
 select * into r from public.checkout_attempt where attempt_id=p_attempt for update;
 if found then
  if r.cliente_id<>p_cliente or r.request_hash<>p_hash then raise exception 'ATTEMPT_CONFLICT'; end if;
  return jsonb_build_object('orderId',r.order_id,'attemptId',r.attempt_id,'started',false,'phase',r.phase);
 end if;
 select * into r from public.checkout_attempt where cliente_id=p_cliente and request_hash=p_hash and phase not in ('CANCELLED','DONE') for update;
 if found then return jsonb_build_object('orderId',r.order_id,'attemptId',r.attempt_id,'started',false,'phase',r.phase); end if;
 order_id:=public.fn_criar_pedido_site(p_cliente,p_address,p_items,p_subtotal,p_total,'ONLINE',p_method);
 update public.venda set central_inventory=true where id=order_id;
 insert into public.checkout_attempt(attempt_id,cliente_id,request_hash,order_id,billing_type) values(p_attempt,p_cliente,p_hash,order_id,p_billing);
 return jsonb_build_object('orderId',order_id,'attemptId',p_attempt,'started',true,'phase','PREPARING');
end $$;

-- This is the only transition that permits sending a gateway POST. It competes
-- atomically with abandonment cancellation: a paused process cannot charge later.
create function public.fn_checkout_sending(p_order bigint,p_customer text)
returns void language plpgsql security definer set search_path=public as $$
begin
 update public.checkout_attempt set phase='SENDING',expected_customer=p_customer,updated_at=now()
 where order_id=p_order and phase='PREPARING' and created_at>now()-interval '20 minutes';
 if not found then raise exception 'CHECKOUT_NOT_SENDABLE'; end if;
end $$;

create function public.fn_checkout_bind(p_order bigint,p_payment text,p_customer text,p_total numeric,p_billing text,p_due date,p_url text,p_status text)
returns boolean language plpgsql security definer set search_path=public as $$
declare r public.checkout_attempt%rowtype; total numeric;
begin
 select * into r from public.checkout_attempt where order_id=p_order for update;
 if not found then return false; end if; -- old orders keep their legacy flow
 select valortotal into total from public.venda where id=p_order for update;
 if r.phase not in ('SENDING','BOUND','REVIEW','DONE') or r.expected_customer is distinct from p_customer or round(total,2)<>round(p_total,2) or r.billing_type<>p_billing or nullif(p_payment,'') is null
   or (r.payment_id is not null and r.payment_id<>p_payment) then raise exception 'PAYMENT_ORDER_MISMATCH'; end if;
 update public.checkout_attempt set payment_id=p_payment,phase=case when phase='DONE' then phase else 'BOUND' end,updated_at=now() where order_id=p_order;
 update public.venda set payment_provider='ASAAS',gateway_payment_id=p_payment,gateway_checkout_url=p_url,gateway_due_date=p_due,
   gateway_status=case when status::text in ('PAGO','CANCELADO') then gateway_status else p_status end,updatedat=now() where id=p_order;
 return true;
end $$;

-- PREPARING: no charge was sent. SENDING/REVIEW must be resolved against Asaas;
-- they are never cancelled merely because a clock/HTTP timeout expired.
create function public.fn_checkout_abandon(p_order bigint)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update public.checkout_attempt set phase='CANCELLED',release_pending=true,updated_at=now()
 where order_id=p_order and phase='PREPARING' and created_at<now()-interval '20 minutes';
 if not found then return false; end if;
 update public.venda set status='CANCELADO',updatedat=now() where id=p_order and status::text='PENDENTE';
 return true;
end $$;

create function public.fn_checkout_fail(p_order bigint,p_definite boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare r public.checkout_attempt%rowtype;
begin
 select * into r from public.checkout_attempt where order_id=p_order for update;
 if not found then return false; end if;
 if r.phase='PREPARING' or (r.phase='SENDING' and p_definite) then
  update public.checkout_attempt set phase='CANCELLED',release_pending=true,updated_at=now() where order_id=p_order;
  update public.venda set status='CANCELADO',updatedat=now() where id=p_order and status::text='PENDENTE';
  return true;
 elsif r.phase='SENDING' then
  update public.checkout_attempt set phase='REVIEW',last_error='Resposta do provedor não confirmada; conciliar antes de liberar estoque.',updated_at=now() where order_id=p_order;
 end if;
 return false;
end $$;

create function public.fn_checkout_cancel_bound(p_order bigint,p_payment text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.checkout_attempt%rowtype; sale public.venda%rowtype;
begin
 select * into r from public.checkout_attempt where order_id=p_order for update;
 select * into sale from public.venda where id=p_order for update;
 if r.payment_id is distinct from p_payment or r.phase not in ('BOUND','CANCELLED') or sale.status::text='PAGO' then raise exception 'CANCELLATION_CONFLICT'; end if;
 update public.checkout_attempt set phase='CANCELLED',release_pending=true,updated_at=now() where order_id=p_order;
 update public.venda set status='CANCELADO',gateway_status='DELETED',updatedat=now() where id=p_order;
end $$;

do $$ declare d text; begin
 select pg_get_functiondef('public.fn_processar_evento_pagamento_asaas_sem_devolucao(text,text,text,bigint,text,text,text)'::regprocedure) into d;
 if position('if not v_venda.estoque_baixado then' in d)=0 or position('estoque_baixado = true,' in d)=0 then raise exception 'Unexpected payment function. Review migration.'; end if;
 d:=replace(d,'if not v_venda.estoque_baixado then','if not v_venda.estoque_baixado and not v_venda.central_inventory then');
 d:=replace(d,'estoque_baixado = true,','estoque_baixado = not v_venda.central_inventory,');
 execute d;
end $$;
revoke all on function public.fn_start_checkout(uuid,bigint,text,text,jsonb,jsonb,numeric,numeric,text),public.fn_checkout_sending(bigint,text),public.fn_checkout_bind(bigint,text,text,numeric,text,date,text,text),public.fn_checkout_abandon(bigint) from public,anon,authenticated;
grant execute on function public.fn_start_checkout(uuid,bigint,text,text,jsonb,jsonb,numeric,numeric,text),public.fn_checkout_sending(bigint,text),public.fn_checkout_bind(bigint,text,text,numeric,text,date,text,text),public.fn_checkout_abandon(bigint) to service_role;
revoke all on function public.fn_checkout_fail(bigint,boolean) from public,anon,authenticated;
grant execute on function public.fn_checkout_fail(bigint,boolean) to service_role;
revoke all on function public.fn_checkout_cancel_bound(bigint,text) from public,anon,authenticated;
grant execute on function public.fn_checkout_cancel_bound(bigint,text) to service_role;
commit;
