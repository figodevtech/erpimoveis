begin;
create or replace function public.fn_proteger_venda_site()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.site_order_link where venda_id = old.id) then
    if tg_op = 'DELETE' then
      raise exception 'Vendas do site nao podem ser excluidas. Preserve o historico do pedido.';
    end if;
    if to_jsonb(new)->'is_deleted' is distinct from to_jsonb(old)->'is_deleted' and coalesce((to_jsonb(new)->>'is_deleted')::boolean, false) then
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
revoke all on function public.fn_proteger_venda_site() from public, anon, authenticated;
revoke all on function public.fn_proteger_itens_venda_site() from public, anon, authenticated;
revoke all on function public.fn_preservar_vinculo_pedido_site() from public, anon, authenticated;
commit;
