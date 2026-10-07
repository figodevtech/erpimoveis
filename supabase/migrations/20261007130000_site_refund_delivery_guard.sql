begin;
create or replace function public.fn_proteger_cancelamento_site_enviado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from public.site_order_link where venda_id = old.id) then
    if old.status_entrega::text in ('ENVIO', 'ENVIADO', 'ENTREGUE') then
      if new.status_entrega is distinct from old.status_entrega
         and coalesce(new.status_entrega::text, '') not in ('ENVIO', 'ENVIADO', 'ENTREGUE') then
        raise exception 'Pedido do site enviado nao pode retornar para uma etapa anterior.';
      end if;
      if new.status is distinct from old.status and new.status::text in ('CANCELADA', 'CANCELADO') then
        raise exception 'Pedido enviado exige devolucao fisica conferida antes de devolver estoque.';
      end if;
    end if;
    if new.status_entrega is distinct from old.status_entrega
       and new.status_entrega::text in ('ENVIO', 'ENVIADO', 'ENTREGUE')
       and exists(select 1 from public.site_order_link where venda_id = old.id
         and (refund_requested_at is not null or refund_status = 'REFUNDED')) then
      raise exception 'Pedido com estorno solicitado nao pode ser enviado ou entregue.';
    end if;
  end if;
  return new;
end;
$$;
create trigger proteger_cancelamento_site_enviado before update on public.venda
for each row execute function public.fn_proteger_cancelamento_site_enviado();
revoke all on function public.fn_proteger_cancelamento_site_enviado() from public, anon, authenticated;
commit;
