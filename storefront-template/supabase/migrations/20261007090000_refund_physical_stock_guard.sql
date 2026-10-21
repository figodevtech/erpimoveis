begin;
create or replace function public.fn_processar_evento_pagamento_asaas(
  p_event_id text,
  p_event_type text,
  p_payment_id text,
  p_venda_id bigint,
  p_gateway_status text,
  p_novo_status text,
  p_forma_pagamento text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda public.venda%rowtype;
  v_item record;
  v_inserted_event_id bigint;
  v_resulting_status text;
begin
  if p_gateway_status like 'CHARGEBACK%' then p_novo_status := 'PENDENTE'; end if;
  if nullif(trim(p_event_id), '') is null
    or nullif(trim(p_payment_id), '') is null
    or p_venda_id is null then
    raise exception 'Evento Asaas incompleto.';
  end if;

  if p_novo_status not in ('PENDENTE', 'PAGO', 'CANCELADO') then
    raise exception 'Status local invalido: %.', p_novo_status;
  end if;

  insert into public.payment_webhook_event (
    provider, event_id, event_type, payment_id, venda_id, gateway_status
  ) values (
    'ASAAS', p_event_id, p_event_type, p_payment_id, p_venda_id, p_gateway_status
  )
  on conflict (provider, event_id) do nothing
  returning id into v_inserted_event_id;

  if v_inserted_event_id is null then
    return 'DUPLICADO';
  end if;

  select * into v_venda
  from public.venda
  where id = p_venda_id
    and payment_provider = 'ASAAS'
    and gateway_payment_id = p_payment_id
  for update;

  if not found then
    raise exception 'Venda % nao encontrada ou cobranca Asaas divergente.', p_venda_id;
  end if;

  if p_novo_status = 'PAGO' and v_venda.status <> 'PAGO' then
    if not v_venda.estoque_baixado then
      for v_item in
        select produtoid, quantidade
        from public.vendaproduto
        where venda_id = p_venda_id
        order by produtoid
      loop
        update public.produto
        set estoque = estoque - v_item.quantidade,
            updatedat = now()
        where id = v_item.produtoid
          and estoque >= v_item.quantidade;

        if not found then
          raise exception 'Estoque insuficiente para o produto %.', v_item.produtoid;
        end if;
      end loop;
    end if;

    update public.venda
    set status = 'PAGO',
        estoque_baixado = true,
        forma_pagamento = coalesce(nullif(p_forma_pagamento, ''), forma_pagamento),
        gateway_status = p_gateway_status,
        updatedat = now()
    where id = p_venda_id;

  elsif p_novo_status = 'CANCELADO' then
    if v_venda.estoque_baixado and coalesce(v_venda.status_entrega::text, '') not in ('ENVIADO', 'ENTREGUE') and v_venda.enviado_em is null and v_venda.entregue_em is null and p_gateway_status not like 'CHARGEBACK%' then
      for v_item in
        select produtoid, quantidade
        from public.vendaproduto
        where venda_id = p_venda_id
        order by produtoid
      loop
        update public.produto
        set estoque = estoque + v_item.quantidade,
            updatedat = now()
        where id = v_item.produtoid;
      end loop;
    end if;

    update public.venda
    set status = 'CANCELADO',
        estoque_baixado = case when coalesce(v_venda.status_entrega::text, '') in ('ENVIADO', 'ENTREGUE') or v_venda.enviado_em is not null or v_venda.entregue_em is not null or p_gateway_status like 'CHARGEBACK%' then v_venda.estoque_baixado else false end,
        gateway_status = p_gateway_status,
        updatedat = now()
    where id = p_venda_id;

  else
    update public.venda
    set status = case
          when status in ('PAGO', 'CANCELADO') then status
          else 'PENDENTE'
        end,
        gateway_status = p_gateway_status,
        updatedat = now()
    where id = p_venda_id;
  end if;

  select status into v_resulting_status
  from public.venda
  where id = p_venda_id;

  update public.payment_webhook_event
  set resulting_order_status = v_resulting_status
  where id = v_inserted_event_id;

  return 'PROCESSADO';
end;
$$;


commit;
