begin;

create table if not exists public.mercadolivre_return_inventory (
  id bigint generated always as identity primary key,
  empresa_id integer not null references public.empresa(id) on delete cascade,
  request_key uuid not null,
  claim_id bigint not null references public.mercadolivre_claim(id) on delete cascade,
  order_id bigint not null references public.mercadolivre_order(id) on delete cascade,
  venda_id integer not null references public.venda(id) on delete restrict,
  produto_id integer not null references public.produto(id) on delete restrict,
  disposition text not null check (disposition in ('RESTOCK', 'DAMAGED', 'NOT_RETURNED')),
  quantity integer not null check (quantity > 0),
  restored_quantity integer not null default 0 check (restored_quantity >= 0),
  stock_before integer,
  stock_after integer,
  note text,
  processed_by uuid,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint mercadolivre_return_inventory_request_key_key unique (request_key)
);

create index if not exists mercadolivre_return_inventory_empresa_idx
  on public.mercadolivre_return_inventory(empresa_id, processed_at desc);
create index if not exists mercadolivre_return_inventory_venda_idx
  on public.mercadolivre_return_inventory(venda_id);

create index if not exists mercadolivre_return_inventory_claim_idx
  on public.mercadolivre_return_inventory(claim_id);

create index if not exists mercadolivre_return_inventory_claim_product_idx
  on public.mercadolivre_return_inventory(claim_id, produto_id);

alter table public.mercadolivre_return_inventory enable row level security;
revoke all on table public.mercadolivre_return_inventory from public, anon, authenticated;
grant all on table public.mercadolivre_return_inventory to service_role;
grant usage, select on sequence public.mercadolivre_return_inventory_id_seq to service_role;

-- Um reembolso após o envio encerra a venda financeira, mas não prova que a
-- mercadoria retornou em condição de venda. Mantemos a baixa até a conferência.
create or replace function public.cancelar_venda_marketplace_sem_repor_estoque(
  p_venda_id integer,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda public.venda%rowtype;
  v_transacoes_excluidas integer := 0;
begin
  if p_motivo is null or char_length(btrim(p_motivo)) < 3 then
    raise exception 'Informe um motivo com pelo menos 3 caracteres.' using errcode = '22023';
  end if;

  select * into v_venda from public.venda where id = p_venda_id for update;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;
  if v_venda.status::text in ('CANCELADA', 'CANCELADO') then
    return jsonb_build_object('vendaId', p_venda_id, 'status', 'CANCELADA', 'alreadyCancelled', true);
  end if;
  if exists (
    select 1 from public.nfe
     where vendaid = p_venda_id
       and status::text not in ('RASCUNHO', 'CANCELADA', 'REJEITADA')
  ) then
    raise exception 'Cancele a NF-e autorizada ou em processamento antes de encerrar a venda.' using errcode = '23514';
  end if;

  update public.transacao
     set pendente = false,
         is_deleted = true,
         deleted_at = now(),
         updated_at = now()
   where vendaid = p_venda_id
     and not is_deleted;
  get diagnostics v_transacoes_excluidas = row_count;

  update public.venda
     set status = 'CANCELADA',
         motivo_cancelamento = nullif(btrim(p_motivo), ''),
         cancelada_at = now(),
         updatedat = now(),
         status_entrega = null
   where id = p_venda_id;

  return jsonb_build_object(
    'vendaId', p_venda_id,
    'status', 'CANCELADA',
    'estoqueAguardandoConferencia', true,
    'transacoesExcluidas', v_transacoes_excluidas
  );
end;
$$;

revoke all on function public.cancelar_venda_marketplace_sem_repor_estoque(integer, text)
  from public, anon, authenticated;
grant execute on function public.cancelar_venda_marketplace_sem_repor_estoque(integer, text)
  to service_role;

create or replace function public.processar_devolucao_mercadolivre_estoque(
  p_empresa_id integer,
  p_request_key uuid,
  p_ml_claim_id text,
  p_produto_id integer,
  p_disposition text,
  p_quantity integer,
  p_note text default null,
  p_processed_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.mercadolivre_claim%rowtype;
  v_order public.mercadolivre_order%rowtype;
  v_existing public.mercadolivre_return_inventory%rowtype;
  v_sold_quantity integer;
  v_processed_quantity integer := 0;
  v_deducted_quantity integer := 0;
  v_restored_quantity integer := 0;
  v_stock_before integer;
  v_stock_after integer;
  v_disposition text := upper(btrim(coalesce(p_disposition, '')));
begin
  if p_empresa_id is null or p_request_key is null or p_ml_claim_id is null or btrim(p_ml_claim_id) = '' or p_produto_id is null then
    raise exception 'Empresa, operação, reclamação e produto são obrigatórios.' using errcode = '22023';
  end if;
  if v_disposition not in ('RESTOCK', 'DAMAGED', 'NOT_RETURNED') then
    raise exception 'Destinação da devolução inválida.' using errcode = '22023';
  end if;
  if v_disposition in ('DAMAGED', 'NOT_RETURNED') and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Informe uma observação para itens avariados ou não retornados.' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A quantidade conferida deve ser maior que zero.' using errcode = '22023';
  end if;

  select * into v_claim
    from public.mercadolivre_claim
   where empresa_id = p_empresa_id
     and ml_claim_id = btrim(p_ml_claim_id)
   for update;
  if not found then
    raise exception 'Devolução do Mercado Livre não encontrada.' using errcode = 'P0002';
  end if;
  if v_claim.return_id is null then
    raise exception 'A reclamação ainda não possui uma devolução identificada pelo Mercado Livre.' using errcode = '22023';
  end if;

  select * into v_order
    from public.mercadolivre_order
   where id = v_claim.order_id
     and empresa_id = p_empresa_id;
  if not found or v_order.venda_id is null then
    raise exception 'A devolução não possui uma venda vinculada no ERP.' using errcode = 'P0002';
  end if;

  select * into v_existing
    from public.mercadolivre_return_inventory
   where request_key = p_request_key;
  if found then
    return jsonb_build_object(
      'id', v_existing.id,
      'alreadyProcessed', true,
      'disposition', v_existing.disposition,
      'quantity', v_existing.quantity,
      'restoredQuantity', v_existing.restored_quantity,
      'stockBefore', v_existing.stock_before,
      'stockAfter', v_existing.stock_after,
      'processedAt', v_existing.processed_at
    );
  end if;

  select coalesce(sum(quantidade), 0)::integer into v_sold_quantity
    from public.vendaproduto
   where venda_id = v_order.venda_id
     and produtoid = p_produto_id;
  if v_sold_quantity <= 0 then
    raise exception 'O produto informado não pertence à venda desta devolução.' using errcode = '22023';
  end if;
  if p_quantity > v_sold_quantity then
    raise exception 'A quantidade devolvida não pode superar a quantidade vendida (%).', v_sold_quantity using errcode = '22023';
  end if;

  select coalesce(sum(quantity), 0)::integer into v_processed_quantity
    from public.mercadolivre_return_inventory
   where claim_id = v_claim.id
     and produto_id = p_produto_id;
  if p_quantity > v_sold_quantity - v_processed_quantity then
    raise exception 'A quantidade informada supera o saldo pendente de conferência (%).', greatest(v_sold_quantity - v_processed_quantity, 0)
      using errcode = '22023';
  end if;

  select estoque into v_stock_before
    from public.produto
   where id = p_produto_id
   for update;
  if not found then
    raise exception 'Produto não encontrado no estoque.' using errcode = 'P0002';
  end if;

  select coalesce(quantidade, 0)::integer into v_deducted_quantity
    from public.vendaproduto_baixa
   where venda_id = v_order.venda_id
     and produtoid = p_produto_id;
  v_deducted_quantity := coalesce(v_deducted_quantity, 0);

  if v_disposition = 'RESTOCK' then
    v_restored_quantity := least(p_quantity, v_deducted_quantity);
    if v_restored_quantity > 0 then
      perform public.fn_sincronizar_baixa_estoque_marketplace(
        v_order.venda_id,
        p_produto_id,
        v_deducted_quantity - v_restored_quantity
      );
    end if;
  end if;

  select estoque into v_stock_after from public.produto where id = p_produto_id;

  insert into public.mercadolivre_return_inventory (
    empresa_id, request_key, claim_id, order_id, venda_id, produto_id, disposition,
    quantity, restored_quantity, stock_before, stock_after, note, processed_by
  ) values (
    p_empresa_id, p_request_key, v_claim.id, v_order.id, v_order.venda_id, p_produto_id, v_disposition,
    p_quantity, v_restored_quantity, v_stock_before, v_stock_after,
    nullif(btrim(coalesce(p_note, '')), ''), p_processed_by
  ) returning * into v_existing;

  return jsonb_build_object(
    'id', v_existing.id,
    'alreadyProcessed', false,
    'disposition', v_existing.disposition,
    'quantity', v_existing.quantity,
    'restoredQuantity', v_existing.restored_quantity,
    'stockBefore', v_existing.stock_before,
    'stockAfter', v_existing.stock_after,
    'processedAt', v_existing.processed_at
  );
end;
$$;

revoke all on function public.processar_devolucao_mercadolivre_estoque(integer, uuid, text, integer, text, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.processar_devolucao_mercadolivre_estoque(integer, uuid, text, integer, text, integer, text, uuid)
  to service_role;

comment on table public.mercadolivre_return_inventory is
  'Conferência física e destinação de itens devolvidos pelo Mercado Livre, separada do reembolso financeiro.';

commit;
