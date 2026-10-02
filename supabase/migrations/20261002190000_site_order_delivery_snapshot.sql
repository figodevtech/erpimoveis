begin;

create or replace function public.fn_sync_site_order_delivery_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_endereco jsonb;
begin
  if new.venda_id is null then
    return new;
  end if;

  v_endereco := coalesce(new.raw_order->'shippingAddress', '{}'::jsonb);
  if jsonb_typeof(v_endereco) = 'object' and v_endereco <> '{}'::jsonb then
    update public.venda
       set endereco_entrega_snapshot = v_endereco,
           updatedat = now()
     where id = new.venda_id
       and endereco_entrega_snapshot is distinct from v_endereco;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_site_order_delivery_snapshot on public.site_order_link;
create trigger trg_sync_site_order_delivery_snapshot
after insert or update of venda_id, raw_order on public.site_order_link
for each row execute function public.fn_sync_site_order_delivery_snapshot();

update public.venda v
   set endereco_entrega_snapshot = l.raw_order->'shippingAddress',
       updatedat = now()
  from public.site_order_link l
 where l.venda_id = v.id
   and jsonb_typeof(l.raw_order->'shippingAddress') = 'object'
   and l.raw_order->'shippingAddress' <> '{}'::jsonb
   and v.endereco_entrega_snapshot is distinct from l.raw_order->'shippingAddress';

commit;
