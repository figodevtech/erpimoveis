begin;

-- Operational orders are not sales/revenue. produto.estoque remains the shared
-- available balance used by the shop, counter and OS. No second held-stock sum.
create table public.site_checkout (
  empresa_id integer not null references public.empresa(id),
  site_order_id bigint not null check (site_order_id > 0),
  state text not null check (state in ('RESERVED','CONFIRMED','RELEASED')),
  items jsonb not null default '[]',
  payment_id text,
  venda_id integer,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (empresa_id,site_order_id)
);
create index site_checkout_pending_idx on public.site_checkout(empresa_id,updated_at) where state='RESERVED';
alter table public.site_checkout enable row level security;
revoke all on public.site_checkout from public,anon,authenticated;
grant all on public.site_checkout to service_role;

alter table public.estoque_movimento add column pedido_online_id bigint;
alter table public.estoque_movimento drop constraint estoque_movimento_origem_check;
alter table public.estoque_movimento add constraint estoque_movimento_origem_check
 check (origem in ('ENTRADA','SAIDA_MANUAL','VENDA','ORDEM_SERVICO','NAO_IDENTIFICADA','PEDIDO_ONLINE'));

-- Preserve the installed trigger, adding only the new document origin.
do $$ declare d text; begin
 select pg_get_functiondef('public.tg_estoque_movimento_registrar()'::regprocedure) into d;
 if position('''ORDEM_SERVICO'')' in d)=0 or position('entrada_id, saida_id, venda_id, ordemservicoid,' in d)=0 then
   raise exception 'Unexpected stock ledger definition. Review before deployment.';
 end if;
 d:=replace(d,'''ORDEM_SERVICO'')','''ORDEM_SERVICO'', ''PEDIDO_ONLINE'')');
 d:=replace(d,'entrada_id, saida_id, venda_id, ordemservicoid,','entrada_id, saida_id, venda_id, ordemservicoid, pedido_online_id,');
 d:=replace(d,'CASE WHEN v_origem = ''ORDEM_SERVICO'' THEN v_documento::integer END,',
  'CASE WHEN v_origem = ''ORDEM_SERVICO'' THEN v_documento::integer END, CASE WHEN v_origem = ''PEDIDO_ONLINE'' THEN v_documento END,');
 execute d;
end $$;

create function public.fn_site_checkout_available(p_empresa_id integer,p_ids integer[])
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('productId',produto_id,'available',greatest(estoque,0),'price',preco)), '[]'::jsonb)
 from public.site_catalog_export where empresa_id=p_empresa_id and produto_id=any(p_ids) and visible=true;
$$;

create function public.fn_site_checkout_reserve(p_empresa_id integer,p_order_id bigint,p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.site_checkout%rowtype; canonical jsonb; i jsonb; catalog jsonb;
begin
 if p_order_id is null or p_order_id<=0 or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'INVALID_ITEMS'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where coalesce((x->>'productId')::integer,0)<=0 or coalesce((x->>'quantity')::integer,0)<=0 or coalesce((x->>'unitPrice')::numeric,0)<=0) then raise exception 'INVALID_ITEMS'; end if;
 select jsonb_agg(jsonb_build_object('productId',id,'quantity',qty,'unitPrice',price) order by id) into canonical from (
   select (x->>'productId')::integer id,sum((x->>'quantity')::integer)::integer qty,round(min((x->>'unitPrice')::numeric),2) price
   from jsonb_array_elements(p_items) x group by 1 having min((x->>'unitPrice')::numeric)=max((x->>'unitPrice')::numeric)
 ) t;
 if jsonb_array_length(canonical)<>(select count(distinct x->>'productId') from jsonb_array_elements(p_items) x) then raise exception 'INVALID_ITEMS'; end if;
 -- Per-order lock also covers non-existent orders and cancellation tombstones.
 perform pg_advisory_xact_lock(hashtextextended('site-checkout:'||p_empresa_id||':'||p_order_id,0));
 select * into r from public.site_checkout where empresa_id=p_empresa_id and site_order_id=p_order_id for update;
 if found then
   if r.state<>'RESERVED' or r.items<>canonical then raise exception 'CHECKOUT_CLOSED'; end if;
   return jsonb_build_object('reserved',true);
 end if;
 if exists(select 1 from public.site_order_link where empresa_id=p_empresa_id and site_order_id=p_order_id) then raise exception 'ORDER_ALREADY_IMPORTED'; end if;
 -- Fixed lock order avoids deadlocks for baskets containing the same products.
 perform 1 from public.produto where id in(select (x->>'productId')::integer from jsonb_array_elements(canonical) x) order by id for update;
 catalog:=public.fn_site_checkout_available(p_empresa_id,array(select (x->>'productId')::integer from jsonb_array_elements(canonical) x));
 for i in select * from jsonb_array_elements(canonical) loop
   if coalesce((select (c->>'available')::integer from jsonb_array_elements(catalog) c where c->>'productId'=i->>'productId'),0)<(i->>'quantity')::integer then raise exception 'INSUFFICIENT_STOCK:%',i->>'productId'; end if;
   if not exists(select 1 from jsonb_array_elements(catalog) c where c->>'productId'=i->>'productId' and round((c->>'price')::numeric,2)=round((i->>'unitPrice')::numeric,2)) then raise exception 'SITE_PRICE_CHANGED:%',i->>'productId'; end if;
 end loop;
 insert into public.site_checkout(empresa_id,site_order_id,state,items) values(p_empresa_id,p_order_id,'RESERVED',canonical);
 perform public.estoque_definir_contexto('PEDIDO_ONLINE',p_order_id,'Reserva do site #'||p_order_id,null);
 for i in select * from jsonb_array_elements(canonical) loop
   perform public.fn_baixa_estoque_produto((i->>'productId')::integer,(i->>'quantity')::integer);
 end loop;
 return jsonb_build_object('reserved',true);
end $$;

-- Caller must first prove at the store/payment provider that charging cannot
-- still start. A tombstone fences a delayed reservation request as well.
create function public.fn_site_checkout_release(p_empresa_id integer,p_order_id bigint,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.site_checkout%rowtype; i jsonb;
begin
 if p_order_id is null or p_order_id<=0 then raise exception 'INVALID_ORDER'; end if;
 perform pg_advisory_xact_lock(hashtextextended('site-checkout:'||p_empresa_id||':'||p_order_id,0));
 select * into r from public.site_checkout where empresa_id=p_empresa_id and site_order_id=p_order_id for update;
 if not found then
   insert into public.site_checkout(empresa_id,site_order_id,state,reason) values(p_empresa_id,p_order_id,'RELEASED',p_reason);
   return;
 end if;
 if r.state='RELEASED' then return; end if;
 if r.state='CONFIRMED' then raise exception 'CONFIRMED_ORDER_USE_RETURN_WORKFLOW'; end if;
 perform 1 from public.produto where id in(select (x->>'productId')::integer from jsonb_array_elements(r.items) x) order by id for update;
 perform public.estoque_definir_contexto('PEDIDO_ONLINE',p_order_id,'Cancelamento da reserva do site #'||p_order_id,null);
 for i in select * from jsonb_array_elements(r.items) loop
   update public.produto set estoque=estoque+(i->>'quantity')::integer where id=(i->>'productId')::integer;
 end loop;
 update public.site_checkout set state='RELEASED',reason=p_reason,updated_at=now() where empresa_id=p_empresa_id and site_order_id=p_order_id;
end $$;

create function public.fn_site_checkout_refund_before_import(p_empresa_id integer,p_order_id bigint)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_state text;
begin
 perform pg_advisory_xact_lock(hashtextextended('site-checkout:'||p_empresa_id||':'||p_order_id,0));
 select state into current_state from public.site_checkout where empresa_id=p_empresa_id and site_order_id=p_order_id for update;
 if current_state='CONFIRMED' then return false; end if;
 perform public.fn_site_checkout_release(p_empresa_id,p_order_id,'Estorno confirmado antes da importação da venda');
 return true;
end $$;

create function public.fn_confirmar_checkout_site(p_empresa_id integer,p_pedido jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare r public.site_checkout%rowtype; canonical jsonb; sale integer; modified jsonb; i jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('site-checkout:'||p_empresa_id||':'||(p_pedido->>'id'),0));
 select * into r from public.site_checkout where empresa_id=p_empresa_id and site_order_id=(p_pedido->>'id')::bigint for update;
 if not found then
   if coalesce((p_pedido->>'centralInventory')::boolean,false) then raise exception 'MISSING_ERP_RESERVATION'; end if;
   return public.fn_importar_pedido_site(p_empresa_id,p_pedido);
 end if;
 if r.state='RELEASED' then raise exception 'PAID_AFTER_RELEASE_REVIEW_REQUIRED'; end if;
 if r.state='CONFIRMED' then
   if r.payment_id is distinct from p_pedido->>'gatewayPaymentId' then raise exception 'PAYMENT_MISMATCH'; end if;
   return r.venda_id;
 end if;
 if p_pedido->>'status'<>'PAGO' or nullif(p_pedido->>'gatewayPaymentId','') is null then raise exception 'PAYMENT_REQUIRED'; end if;
 select jsonb_agg(jsonb_build_object('productId',id,'quantity',qty,'unitPrice',price) order by id) into canonical from (
   select (x->>'produtoId')::integer id,sum((x->>'quantidade')::integer)::integer qty,
    round(sum((x->>'valorTotal')::numeric)/sum((x->>'quantidade')::integer),2) price from jsonb_array_elements(p_pedido->'items') x group by 1
 ) t;
 if canonical is distinct from r.items then raise exception 'RESERVATION_ITEMS_MISMATCH'; end if;
 select jsonb_set(p_pedido,'{items}',jsonb_agg(jsonb_set(x,'{baixarEstoque}','false'::jsonb))) into modified from jsonb_array_elements(p_pedido->'items') x;
 sale:=public.fn_importar_pedido_site(p_empresa_id,modified);
 for i in select * from jsonb_array_elements(r.items) loop
   insert into public.vendaproduto_baixa(venda_id,produtoid,quantidade,created_at,updated_at)
   values(sale,(i->>'productId')::integer,(i->>'quantity')::integer,now(),now());
 end loop;
 update public.site_checkout set state='CONFIRMED',payment_id=p_pedido->>'gatewayPaymentId',venda_id=sale,updated_at=now() where empresa_id=p_empresa_id and site_order_id=r.site_order_id;
 return sale;
end $$;

revoke all on function public.fn_site_checkout_available(integer,integer[]),public.fn_site_checkout_reserve(integer,bigint,jsonb),public.fn_site_checkout_release(integer,bigint,text),public.fn_confirmar_checkout_site(integer,jsonb) from public,anon,authenticated;
grant execute on function public.fn_site_checkout_available(integer,integer[]),public.fn_site_checkout_reserve(integer,bigint,jsonb),public.fn_site_checkout_release(integer,bigint,text),public.fn_confirmar_checkout_site(integer,jsonb) to service_role;
revoke all on function public.fn_site_checkout_refund_before_import(integer,bigint) from public,anon,authenticated;
grant execute on function public.fn_site_checkout_refund_before_import(integer,bigint) to service_role;
commit;
