begin;
create table if not exists public.site_stock_reservation (
 empresa_id integer not null references public.empresa(id), site_order_id bigint not null,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','CONSUMED','RELEASED')),
 items jsonb not null, created_at timestamptz not null default now(),
 expires_at timestamptz not null, updated_at timestamptz not null default now(),
 primary key(empresa_id,site_order_id)
);
alter table public.site_stock_reservation enable row level security;
create index if not exists site_stock_reservation_active_idx on public.site_stock_reservation(empresa_id,expires_at) where status='ACTIVE';
revoke all on public.site_stock_reservation from public,anon,authenticated;
grant all on public.site_stock_reservation to service_role;

create or replace function public.fn_site_stock_available(p_empresa_id integer,p_ids integer[])
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('productId',p.produto_id,'available',greatest(p.estoque-coalesce((
  select sum((i->>'quantity')::integer) from public.site_stock_reservation r cross join lateral jsonb_array_elements(r.items) i
  where r.status='ACTIVE' and (i->>'productId')::integer=p.produto_id
 ),0),0))), '[]'::jsonb)
 from public.site_catalog_export p where p.empresa_id=p_empresa_id and p.produto_id=any(p_ids) and p.visible=true;
$$;

create or replace function public.fn_site_stock_reserve(p_empresa_id integer,p_order_id bigint,p_items jsonb,p_minutes integer default 15)
returns jsonb language plpgsql security definer set search_path=public as $$
declare canonical jsonb; existing public.site_stock_reservation%rowtype; item jsonb; available jsonb;
begin
 if p_order_id<=0 or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'INVALID_ITEMS'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) i where (i->>'productId')::integer<=0 or (i->>'quantity')::integer<=0 or i->>'productId' is null or i->>'quantity' is null) then raise exception 'INVALID_ITEMS'; end if;
 select jsonb_agg(jsonb_build_object('productId',id,'quantity',qty) order by id) into canonical from (
  select (i->>'productId')::integer id,sum((i->>'quantity')::integer)::integer qty from jsonb_array_elements(p_items) i group by 1
 ) x;
 perform pg_advisory_xact_lock(73109,p_empresa_id);
 perform 1 from public.produto where id in (select (i->>'productId')::integer from jsonb_array_elements(canonical) i) order by id for update;
 select * into existing from public.site_stock_reservation where empresa_id=p_empresa_id and site_order_id=p_order_id for update;
 if found then
  if existing.items<>canonical or existing.status<>'ACTIVE' then raise exception 'RESERVATION_CONFLICT'; end if;
  return jsonb_build_object('reserved',true,'expiresAt',existing.expires_at);
 end if;
 available:=public.fn_site_stock_available(p_empresa_id,array(select (i->>'productId')::integer from jsonb_array_elements(canonical) i));
 for item in select * from jsonb_array_elements(canonical) loop
  if coalesce((select (a->>'available')::integer from jsonb_array_elements(available) a where a->>'productId'=item->>'productId'),0)<(item->>'quantity')::integer then
   raise exception 'INSUFFICIENT_STOCK:%',item->>'productId';
  end if;
 end loop;
 insert into public.site_stock_reservation(empresa_id,site_order_id,items,expires_at) values(p_empresa_id,p_order_id,canonical,now()+make_interval(mins=>least(greatest(p_minutes,15),4320)));
 for item in select * from jsonb_array_elements(canonical) loop
  perform public.fn_enfileirar_site_product_link(id) from public.site_product_link where empresa_id=p_empresa_id and produto_id=(item->>'productId')::integer;
 end loop;
 return jsonb_build_object('reserved',true);
end;
$$;

create or replace function public.fn_site_stock_release(p_empresa_id integer,p_order_id bigint)
returns void language plpgsql security definer set search_path=public as $$
declare r public.site_stock_reservation%rowtype; item jsonb;
begin
 perform pg_advisory_xact_lock(73109,p_empresa_id);
 select * into r from public.site_stock_reservation where empresa_id=p_empresa_id and site_order_id=p_order_id;
 if not found or r.status<>'ACTIVE' then return; end if;
 perform 1 from public.produto where id in(select (i->>'productId')::integer from jsonb_array_elements(r.items) i) order by id for update;
 update public.site_stock_reservation set status='RELEASED',updated_at=now() where empresa_id=p_empresa_id and site_order_id=p_order_id;
 for item in select * from jsonb_array_elements(r.items) loop
  perform public.fn_enfileirar_site_product_link(id) from public.site_product_link where empresa_id=p_empresa_id and produto_id=(item->>'productId')::integer;
 end loop;
end;
$$;

create or replace function public.fn_guard_site_stock_reservation()
returns trigger language plpgsql security definer set search_path=public as $$
declare held numeric;
begin
 select coalesce(sum((i->>'quantity')::integer),0) into held from public.site_stock_reservation r cross join lateral jsonb_array_elements(r.items) i where r.status='ACTIVE' and (i->>'productId')::integer=new.id;
 if new.estoque<held then raise exception 'Estoque reservado para pedidos do site. Disponivel: %',greatest(old.estoque-held,0); end if;
 return new;
end;
$$;
drop trigger if exists guard_site_stock_reservation on public.produto;
create trigger guard_site_stock_reservation before update of estoque on public.produto for each row when (new.estoque<old.estoque) execute function public.fn_guard_site_stock_reservation();

-- O importador original baixa estoque ao criar a venda. A reserva deixa de
-- contar na mesma transacao, sem devolver/baixar a peca uma segunda vez.
do $$ begin
 if to_regprocedure('public.fn_importar_pedido_site_sem_reserva(integer,jsonb)') is null then
  alter function public.fn_importar_pedido_site(integer,jsonb) rename to fn_importar_pedido_site_sem_reserva;
 end if;
end $$;
create or replace function public.fn_importar_pedido_site(p_empresa_id integer,p_pedido jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare r public.site_stock_reservation%rowtype; canonical jsonb; sale integer;
begin
 perform pg_advisory_xact_lock(73109,p_empresa_id);
 select * into r from public.site_stock_reservation where empresa_id=p_empresa_id and site_order_id=(p_pedido->>'id')::bigint;
 if found then
  if r.status='RELEASED' then raise exception 'RESERVATION_RELEASED'; end if;
  select jsonb_agg(jsonb_build_object('productId',id,'quantity',qty) order by id) into canonical from (
   select (i->>'produtoId')::integer id,sum((i->>'quantidade')::integer)::integer qty from jsonb_array_elements(p_pedido->'items') i group by 1
  ) x;
  if canonical is distinct from r.items or exists(select 1 from jsonb_array_elements(p_pedido->'items') i where coalesce((i->>'baixarEstoque')::boolean,true)=false) then raise exception 'RESERVATION_ITEMS_MISMATCH'; end if;
  perform 1 from public.produto where id in(select (i->>'productId')::integer from jsonb_array_elements(r.items) i) order by id for update;
  update public.site_stock_reservation set status='CONSUMED',updated_at=now() where empresa_id=p_empresa_id and site_order_id=r.site_order_id;
 end if;
 sale:=public.fn_importar_pedido_site_sem_reserva(p_empresa_id,p_pedido);
 return sale;
end;
$$;
revoke all on function public.fn_importar_pedido_site_sem_reserva(integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.fn_site_stock_available(integer,integer[]),public.fn_site_stock_reserve(integer,bigint,jsonb,integer),public.fn_site_stock_release(integer,bigint),public.fn_guard_site_stock_reservation(),public.fn_importar_pedido_site(integer,jsonb) from public,anon,authenticated;
grant execute on function public.fn_site_stock_available(integer,integer[]),public.fn_site_stock_reserve(integer,bigint,jsonb,integer),public.fn_site_stock_release(integer,bigint),public.fn_importar_pedido_site(integer,jsonb) to service_role;
commit;
