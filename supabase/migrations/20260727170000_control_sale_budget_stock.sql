create or replace function public.fn_criar_venda_com_itens(p_venda jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id integer := (p_venda->>'clienteId')::integer;
  v_created_by uuid := (p_venda->>'created_by')::uuid;
  v_status public.enum_status_venda := (p_venda->>'status')::public.enum_status_venda;
  v_baixar_estoque boolean := coalesce((p_venda->>'baixarEstoque')::boolean, true);
  v_venda_id integer;
  v_item jsonb;
  v_produto_id integer;
  v_quantidade integer;
  v_comissao numeric;
begin
  if v_cliente_id is null or v_created_by is null or v_status is null
     or p_venda->>'subTotal' is null or p_venda->>'valorTotal' is null then
    raise exception 'Campos obrigatórios ausentes em p_venda.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_venda->'itens') <> 'array' or jsonb_array_length(p_venda->'itens') = 0 then
    raise exception 'p_venda.itens deve possuir ao menos um item.' using errcode = 'P0001';
  end if;

  select coalesce(comissao_venda_percent, 0) into v_comissao
    from public.usuario where id = v_created_by;

  if v_baixar_estoque then
    for v_item in select value from jsonb_array_elements(p_venda->'itens') loop
      v_produto_id := (v_item->>'produtoId')::integer;
      v_quantidade := (v_item->>'quantidade')::integer;
      if v_produto_id is null or v_quantidade is null or v_quantidade <= 0 then
        raise exception 'Cada item deve possuir produtoId e quantidade > 0.' using errcode = 'P0001';
      end if;
      perform public.fn_baixa_estoque_produto(v_produto_id, v_quantidade);
    end loop;
  end if;

  insert into public.venda (
    clienteid, created_by, vendedor, status, forma_pagamento, sub_total, valortotal,
    desconto_tipo, desconto_valor, datavenda, comissao_venda_percent_aplicada,
    categoriavendaid
  ) values (
    v_cliente_id, v_created_by, coalesce(nullif(p_venda->>'vendedor', '')::uuid, v_created_by), v_status,
    nullif(p_venda->>'formaPagamento', ''), (p_venda->>'subTotal')::numeric,
    (p_venda->>'valorTotal')::numeric,
    nullif(p_venda->>'descontoTipo', '')::public.enum_tipo_desconto_venda,
    nullif(p_venda->>'descontoValor', '')::numeric,
    coalesce(nullif(p_venda->>'dataVenda', '')::timestamp, now()), v_comissao,
    nullif(p_venda->>'categoriaVendaId', '')::integer
  ) returning id into v_venda_id;

  for v_item in select value from jsonb_array_elements(p_venda->'itens') loop
    v_produto_id := (v_item->>'produtoId')::integer;
    v_quantidade := (v_item->>'quantidade')::integer;
    insert into public.vendaproduto (
      venda_id, produtoid, quantidade, sub_total, valor_total, valor_desconto, tipo_desconto
    ) values (
      v_venda_id, v_produto_id, v_quantidade,
      (v_item->>'subTotal')::numeric, (v_item->>'valorTotal')::numeric,
      nullif(v_item->>'valorDesconto', '')::numeric,
      nullif(v_item->>'tipoDesconto', '')::public.enum_tipo_desconto_venda
    );
    if v_baixar_estoque then
      insert into public.vendaproduto_baixa (venda_id, produtoid, quantidade, updated_at)
      values (v_venda_id, v_produto_id, v_quantidade, now())
      on conflict (venda_id, produtoid) do update
        set quantidade = excluded.quantidade, updated_at = now();
    end if;
  end loop;
  return v_venda_id;
end;
$$;

create or replace function public.fn_aprovar_orcamento_venda(
  p_venda_id integer,
  p_forma_pagamento text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status::text into v_status from public.venda where id = p_venda_id for update;
  if v_status is null then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;
  if v_status <> 'ORCAMENTO' then
    raise exception 'Apenas orçamentos podem ser aprovados.' using errcode = 'P0001';
  end if;
  perform public.fn_baixar_estoque_venda(p_venda_id);
  update public.venda
     set status = 'PAGAMENTO', forma_pagamento = nullif(p_forma_pagamento, ''), updatedat = now()
   where id = p_venda_id;
end;
$$;

revoke all on function public.fn_criar_venda_com_itens(jsonb) from public, anon, authenticated;
revoke all on function public.fn_aprovar_orcamento_venda(integer, text) from public, anon, authenticated;
grant execute on function public.fn_criar_venda_com_itens(jsonb) to service_role;
grant execute on function public.fn_aprovar_orcamento_venda(integer, text) to service_role;
