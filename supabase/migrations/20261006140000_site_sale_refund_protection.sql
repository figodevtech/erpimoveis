begin;
alter table public.site_order_link
  add column if not exists refund_status text,
  add column if not exists refund_requested_at timestamptz,
  add column if not exists refund_reason text,
  add column if not exists refund_checked_at timestamptz;

create or replace function public.fn_proteger_venda_site()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.site_order_link where venda_id = old.id) then
    if tg_op = 'DELETE' then
      raise exception 'Vendas do site nao podem ser excluidas. Preserve o historico do pedido.';
    end if;
    if new.is_deleted is distinct from old.is_deleted and new.is_deleted then
      raise exception 'Vendas do site nao podem ser excluidas.';
    end if;
    if (to_jsonb(new)->'valortotal', to_jsonb(new)->'sub_total', to_jsonb(new)->'clienteid', to_jsonb(new)->'canal')
      is distinct from (to_jsonb(old)->'valortotal', to_jsonb(old)->'sub_total', to_jsonb(old)->'clienteid', to_jsonb(old)->'canal') then
      raise exception 'Valores, cliente e canal da venda do site nao podem ser alterados.';
    end if;
    if new.status is distinct from old.status then
      if new.status::text not in ('CANCELADA', 'CANCELADO') or not exists (
        select 1 from public.site_order_link where venda_id = old.id and refund_status = 'REFUNDED'
      ) then
        raise exception 'A alteracao de status da venda do site exige estorno confirmado no Asaas.';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists proteger_venda_site on public.venda;
create trigger proteger_venda_site before update or delete on public.venda
for each row execute function public.fn_proteger_venda_site();

create or replace function public.fn_proteger_itens_venda_site()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sale_id bigint;
begin
  if tg_table_name = 'transacao' then v_sale_id := old.vendaid;
  else v_sale_id := old.venda_id;
  end if;
  if exists(select 1 from public.site_order_link where venda_id = v_sale_id) then
    if tg_op = 'UPDATE' and tg_table_name = 'transacao' and exists (
      select 1 from public.site_order_link where venda_id = v_sale_id and refund_status = 'REFUNDED'
    ) then return new; end if;
    raise exception 'Nao e permitido alterar ou excluir itens ou lancamentos de uma venda do site.';
  end if;
  if tg_op = 'UPDATE' then return new; end if;
  return old;
end;
$$;
drop trigger if exists proteger_itens_venda_site on public.vendaproduto;
create trigger proteger_itens_venda_site before update or delete on public.vendaproduto for each row execute function public.fn_proteger_itens_venda_site();
drop trigger if exists proteger_transacao_venda_site on public.transacao;
create trigger proteger_transacao_venda_site before update or delete on public.transacao for each row execute function public.fn_proteger_itens_venda_site();
create or replace function public.fn_preservar_vinculo_pedido_site()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.venda_id is not null and (tg_op = 'DELETE' or new.venda_id is distinct from old.venda_id) then
    raise exception 'O vinculo de uma venda do site nao pode ser removido.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger preservar_vinculo_pedido_site before update or delete on public.site_order_link
for each row execute function public.fn_preservar_vinculo_pedido_site();
commit;
