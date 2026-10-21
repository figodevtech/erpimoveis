begin;
alter table public.site_order_refund_request add column if not exists request_url text;
create table public.site_order_return (
 order_id bigint primary key references public.venda(id), reason text not null check(length(reason) between 3 and 500),
 requested_at timestamptz not null default now(), requested_by text not null,
 received_at timestamptz, received_by text, inspection_note text,
 reverse_tracking text, restocked_at timestamptz,
 check(received_at is null or (received_by is not null and length(inspection_note) >= 3))
);
alter table public.site_order_return enable row level security;
revoke all on public.site_order_return from public,anon,authenticated;
grant all on public.site_order_return to service_role;
create function public.fn_receber_devolucao_site(p_order_id bigint,p_operator text,p_note text) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.venda where id=p_order_id for update;
 if coalesce(length(trim(p_operator)),0) < 1 or coalesce(length(trim(p_note)),0) < 3 then raise exception 'Conferencia obrigatoria.'; end if;
 update public.site_order_return set received_at=now(),received_by=p_operator,inspection_note=p_note
 where order_id=p_order_id and received_at is null;
 if not found and not exists(select 1 from public.site_order_return where order_id=p_order_id and received_at is not null)
 then raise exception 'Solicite a devolucao antes de registrar o recebimento.'; end if;
end; $$;
revoke all on function public.fn_receber_devolucao_site(bigint,text,text) from public,anon,authenticated;
grant execute on function public.fn_receber_devolucao_site(bigint,text,text) to service_role;
create or replace function public.fn_processar_evento_pagamento_asaas_sem_devolucao(
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



revoke all on function public.fn_processar_evento_pagamento_asaas_sem_devolucao(text,text,text,bigint,text,text,text) from public,anon,authenticated;
create or replace function public.fn_processar_evento_pagamento_asaas(p_event_id text,p_event_type text,p_payment_id text,p_venda_id bigint,p_gateway_status text,p_novo_status text,p_forma_pagamento text)
returns text language plpgsql security definer set search_path=public as $$
declare result text; sale public.venda%rowtype; item record;
begin
 result:=public.fn_processar_evento_pagamento_asaas_sem_devolucao(p_event_id,p_event_type,p_payment_id,p_venda_id,p_gateway_status,p_novo_status,p_forma_pagamento);
 select * into sale from public.venda where id=p_venda_id and gateway_payment_id=p_payment_id for update;
 if p_gateway_status='REFUNDED' and sale.gateway_status='REFUNDED' and sale.estoque_baixado
 and exists(select 1 from public.site_order_return where order_id=p_venda_id and received_at is not null) then
  for item in select produtoid,quantidade from public.vendaproduto where venda_id=p_venda_id order by produtoid loop
   update public.produto set estoque=estoque+item.quantidade,updatedat=now() where id=item.produtoid;
  end loop;
  update public.venda set estoque_baixado=false where id=p_venda_id;
  update public.site_order_return set restocked_at=now() where order_id=p_venda_id;
 end if;
 return result;
end; $$;
revoke all on function public.fn_processar_evento_pagamento_asaas(text,text,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.fn_processar_evento_pagamento_asaas(text,text,text,bigint,text,text,text) to service_role;
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
     or v_sale.valortotal <> p_amount or ((coalesce(v_sale.status_entrega::text,'') in ('ENVIADO','ENTREGUE')
     or v_sale.enviado_em is not null or v_sale.entregue_em is not null) and not exists(select 1 from public.site_order_return where order_id=p_order_id and received_at is not null)) then return false; end if;
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
