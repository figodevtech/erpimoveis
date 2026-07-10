CREATE OR REPLACE FUNCTION public.fn_criar_venda_marketplace_com_itens(p_venda jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cliente_id integer := COALESCE((p_venda->>'clienteId')::integer, (p_venda->>'clienteid')::integer);
  v_status public.enum_status_venda := COALESCE(NULLIF(p_venda->>'status', '')::public.enum_status_venda, 'ABERTA'::public.enum_status_venda);
  v_canal public.enum_canal_venda := COALESCE(NULLIF(p_venda->>'canal', '')::public.enum_canal_venda, 'MERCADO_LIVRE'::public.enum_canal_venda);
  v_status_entrega public.enum_status_entrega := NULLIF(p_venda->>'statusEntrega', '')::public.enum_status_entrega;
  v_desconto_tipo public.enum_tipo_desconto_venda := NULLIF(COALESCE(p_venda->>'descontoTipo', p_venda->>'desconto_tipo'), '')::public.enum_tipo_desconto_venda;
  v_desconto_valor numeric := NULLIF(COALESCE(p_venda->>'descontoValor', p_venda->>'desconto_valor'), '')::numeric;
  v_sub_total numeric := COALESCE(NULLIF(COALESCE(p_venda->>'subTotal', p_venda->>'sub_total'), '')::numeric, 0);
  v_valor_total numeric := COALESCE(NULLIF(COALESCE(p_venda->>'valorTotal', p_venda->>'valortotal'), '')::numeric, 0);
  v_data_venda timestamptz := COALESCE(NULLIF(p_venda->>'dataVenda', '')::timestamptz, now());
  v_forma_pagamento text := NULLIF(COALESCE(p_venda->>'formaPagamento', p_venda->>'forma_pagamento'), '');
  v_observacoes text := NULLIF(p_venda->>'observacoes', '');
  v_itens jsonb := p_venda->'itens';
  v_item jsonb;
  v_produto_id integer;
  v_quantidade integer;
  v_sub_total_item numeric;
  v_valor_total_item numeric;
  v_baixar_estoque boolean;
  v_venda_id integer;
BEGIN
  IF v_cliente_id IS NULL OR v_sub_total <= 0 OR v_valor_total <= 0 THEN
    RAISE EXCEPTION 'Campos obrigatórios ausentes em p_venda (clienteId, subTotal, valorTotal).';
  END IF;

  IF v_itens IS NULL OR jsonb_typeof(v_itens) <> 'array' OR jsonb_array_length(v_itens) = 0 THEN
    RAISE EXCEPTION 'p_venda.itens deve ser um array não vazio.';
  END IF;

  INSERT INTO public.venda (
    clienteid,
    status,
    canal,
    status_entrega,
    valortotal,
    sub_total,
    desconto_tipo,
    desconto_valor,
    forma_pagamento,
    datavenda,
    createdat,
    updatedat,
    observacoes
  )
  VALUES (
    v_cliente_id,
    v_status,
    v_canal,
    v_status_entrega,
    v_valor_total,
    v_sub_total,
    v_desconto_tipo,
    v_desconto_valor,
    v_forma_pagamento,
    v_data_venda,
    now(),
    now(),
    v_observacoes
  )
  RETURNING id INTO v_venda_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_itens)
  LOOP
    v_produto_id := COALESCE((v_item->>'produtoId')::integer, (v_item->>'produtoid')::integer);
    v_quantidade := COALESCE((v_item->>'quantidade')::integer, 1);
    v_sub_total_item := COALESCE(NULLIF(COALESCE(v_item->>'subTotal', v_item->>'sub_total'), '')::numeric, 0);
    v_valor_total_item := COALESCE(NULLIF(COALESCE(v_item->>'valorTotal', v_item->>'valor_total'), '')::numeric, v_sub_total_item);
    v_baixar_estoque := COALESCE((v_item->>'baixarEstoque')::boolean, true);

    IF v_produto_id IS NULL OR v_quantidade <= 0 THEN
      RAISE EXCEPTION 'Cada item deve possuir produtoId e quantidade > 0.';
    END IF;

    IF v_baixar_estoque THEN
      PERFORM public.fn_baixa_estoque_produto(v_produto_id, v_quantidade);

      INSERT INTO public.vendaproduto_baixa (venda_id, produtoid, quantidade, created_at, updated_at)
      VALUES (v_venda_id, v_produto_id, v_quantidade, now(), now())
      ON CONFLICT (venda_id, produtoid) DO UPDATE
      SET quantidade = EXCLUDED.quantidade,
          updated_at = now();
    END IF;

    INSERT INTO public.vendaproduto (
      venda_id,
      produtoid,
      quantidade,
      sub_total,
      valor_total,
      valor_desconto,
      tipo_desconto
    )
    VALUES (
      v_venda_id,
      v_produto_id,
      v_quantidade,
      v_sub_total_item,
      v_valor_total_item,
      NULL,
      NULL
    );
  END LOOP;

  RETURN v_venda_id;
END;
$$;

GRANT ALL ON FUNCTION public.fn_criar_venda_marketplace_com_itens(jsonb) TO anon;
GRANT ALL ON FUNCTION public.fn_criar_venda_marketplace_com_itens(jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.fn_criar_venda_marketplace_com_itens(jsonb) TO service_role;
