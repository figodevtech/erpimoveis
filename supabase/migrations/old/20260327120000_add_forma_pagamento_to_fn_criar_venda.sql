create or replace function public.fn_criar_venda_com_itens(p_venda jsonb)
returns integer
language plpgsql
security definer
as $$
declare
  v_cliente_id integer;
  v_created_by uuid;
  v_status public.enum_status_venda;
  v_forma_pagamento text;
  v_desconto_tipo public.enum_tipo_desconto_venda;
  v_desconto_valor numeric;
  v_sub_total numeric;
  v_valor_total numeric;
  v_data_venda timestamp;
  v_venda_id integer;
  v_itens jsonb;
  v_item jsonb;
  v_produto_id integer;
  v_quantidade integer;
  v_item_sub_total numeric;
  v_item_valor_total numeric;
  v_item_valor_desconto numeric;
  v_item_tipo_desconto public.enum_tipo_desconto_venda;
begin
  v_cliente_id := (p_venda->>'clienteId')::integer;
  v_created_by := (p_venda->>'created_by')::uuid;
  v_status := (p_venda->>'status')::public.enum_status_venda;
  v_sub_total := (p_venda->>'subTotal')::numeric;
  v_valor_total := (p_venda->>'valorTotal')::numeric;
  v_data_venda := nullif(p_venda->>'dataVenda', '')::timestamp;
  v_forma_pagamento := nullif(p_venda->>'formaPagamento', '');

  if v_cliente_id is null
     or v_created_by is null
     or v_status is null
     or v_sub_total is null
     or v_valor_total is null then
    raise exception 'Campos obrigatórios ausentes em p_venda (clienteId, created_by, status, subTotal, valorTotal).'
      using errcode = 'P0001';
  end if;

  if p_venda ? 'descontoTipo' then
    v_desconto_tipo := nullif(p_venda->>'descontoTipo', '')::public.enum_tipo_desconto_venda;
  end if;

  if p_venda ? 'descontoValor' then
    v_desconto_valor := nullif(p_venda->>'descontoValor', '')::numeric;
  end if;

  v_itens := p_venda->'itens';

  if v_itens is null or jsonb_typeof(v_itens) <> 'array' then
    raise exception 'p_venda.itens deve ser um array JSON.'
      using errcode = 'P0001';
  end if;

  if jsonb_array_length(v_itens) = 0 then
    raise exception 'p_venda.itens não pode ser vazio.'
      using errcode = 'P0001';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(v_itens) as t(value)
  loop
    v_produto_id := (v_item->>'produtoId')::integer;
    v_quantidade := (v_item->>'quantidade')::integer;

    if v_produto_id is null or v_quantidade is null or v_quantidade <= 0 then
      raise exception 'Cada item deve possuir produtoId e quantidade > 0.'
        using errcode = 'P0001';
    end if;

    perform public.fn_baixa_estoque_produto(v_produto_id, v_quantidade);
  end loop;

  insert into public.venda (
    clienteid,
    created_by,
    status,
    forma_pagamento,
    sub_total,
    valortotal,
    desconto_tipo,
    desconto_valor,
    datavenda
  ) values (
    v_cliente_id,
    v_created_by,
    v_status,
    v_forma_pagamento,
    v_sub_total,
    v_valor_total,
    v_desconto_tipo,
    v_desconto_valor,
    coalesce(v_data_venda, now())
  )
  returning id into v_venda_id;

  for v_item in
    select value
    from jsonb_array_elements(v_itens) as t(value)
  loop
    v_produto_id := (v_item->>'produtoId')::integer;
    v_quantidade := (v_item->>'quantidade')::integer;
    v_item_sub_total := (v_item->>'subTotal')::numeric;
    v_item_valor_total := (v_item->>'valorTotal')::numeric;

    if v_item->>'valorDesconto' is not null then
      v_item_valor_desconto := (v_item->>'valorDesconto')::numeric;
    else
      v_item_valor_desconto := null;
    end if;

    if v_item->>'tipoDesconto' is not null then
      v_item_tipo_desconto := (v_item->>'tipoDesconto')::public.enum_tipo_desconto_venda;
    else
      v_item_tipo_desconto := null;
    end if;

    insert into public.vendaproduto (
      venda_id,
      produtoid,
      quantidade,
      sub_total,
      valor_total,
      valor_desconto,
      tipo_desconto
    ) values (
      v_venda_id,
      v_produto_id,
      v_quantidade,
      v_item_sub_total,
      v_item_valor_total,
      v_item_valor_desconto,
      v_item_tipo_desconto
    );
  end loop;

  return v_venda_id;
end;
$$;
