BEGIN;

ALTER TABLE public.vendaproduto
  ADD COLUMN IF NOT EXISTS valor_frete numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.vendaproduto
  DROP CONSTRAINT IF EXISTS vendaproduto_valor_frete_nao_negativo;

ALTER TABLE public.vendaproduto
  ADD CONSTRAINT vendaproduto_valor_frete_nao_negativo
  CHECK (valor_frete >= 0);

COMMENT ON COLUMN public.vendaproduto.valor_frete IS
  'Frete atribuído especificamente ao item; separado do frete geral da venda.';

CREATE OR REPLACE FUNCTION public.fn_criar_venda_com_itens(p_venda jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_id integer := (p_venda->>'clienteId')::integer;
  v_created_by uuid := (p_venda->>'created_by')::uuid;
  v_status public.enum_status_venda := (p_venda->>'status')::public.enum_status_venda;
  v_baixar_estoque boolean := coalesce((p_venda->>'baixarEstoque')::boolean, true);
  v_valor_frete numeric(14,2) := round(coalesce(nullif(p_venda->>'valorFrete', '')::numeric, 0), 2);
  v_venda_id integer;
  v_item jsonb;
  v_produto_id integer;
  v_quantidade integer;
  v_item_sub_total numeric(14,2);
  v_item_valor_total numeric(14,2);
  v_item_valor_desconto numeric(14,2);
  v_item_tipo_desconto public.enum_tipo_desconto_venda;
  v_item_desconto_aplicado numeric(14,2);
  v_item_valor_frete numeric(14,2);
  v_comissao numeric;
BEGIN
  IF v_cliente_id IS NULL OR v_created_by IS NULL OR v_status IS NULL
     OR p_venda->>'subTotal' IS NULL OR p_venda->>'valorTotal' IS NULL THEN
    RAISE EXCEPTION 'Campos obrigatórios ausentes em p_venda.' USING ERRCODE = 'P0001';
  END IF;
  IF v_valor_frete < 0 THEN
    RAISE EXCEPTION 'O valor do frete não pode ser negativo.' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_venda->'itens') <> 'array' OR jsonb_array_length(p_venda->'itens') = 0 THEN
    RAISE EXCEPTION 'p_venda.itens deve possuir ao menos um item.' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(comissao_venda_percent, 0)
    INTO v_comissao
    FROM public.usuario
   WHERE id = v_created_by;

  INSERT INTO public.venda (
    clienteid, created_by, vendedor, status, statusaprovacao,
    forma_pagamento, pagamentos_previstos, parcelas_pagamento,
    descricao, observacoes, descricao_financeiro, observacoes_fiscais, garantia,
    sub_total, valortotal, desconto_tipo, desconto_valor, valor_frete, datavenda,
    comissao_venda_percent_aplicada, categoriavendaid
  ) VALUES (
    v_cliente_id,
    v_created_by,
    coalesce(nullif(p_venda->>'vendedor', '')::uuid, v_created_by),
    v_status,
    NULL,
    nullif(p_venda->>'formaPagamento', ''),
    nullif(p_venda->'pagamentosPrevistos', 'null'::jsonb),
    nullif(p_venda->>'parcelasPagamento', '')::integer,
    nullif(btrim(p_venda->>'descricao'), ''),
    nullif(btrim(p_venda->>'observacoes'), ''),
    nullif(btrim(p_venda->>'descricaoFinanceiro'), ''),
    nullif(btrim(p_venda->>'observacoesFiscais'), ''),
    nullif(btrim(p_venda->>'garantia'), ''),
    (p_venda->>'subTotal')::numeric,
    (p_venda->>'valorTotal')::numeric,
    nullif(p_venda->>'descontoTipo', '')::public.enum_tipo_desconto_venda,
    nullif(p_venda->>'descontoValor', '')::numeric,
    v_valor_frete,
    coalesce(nullif(p_venda->>'dataVenda', '')::timestamp, now()),
    v_comissao,
    nullif(p_venda->>'categoriaVendaId', '')::integer
  ) RETURNING id INTO v_venda_id;

  IF v_baixar_estoque THEN
    PERFORM public.estoque_definir_contexto(
      'VENDA', v_venda_id::bigint, 'Venda #' || v_venda_id, v_created_by
    );
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_venda->'itens') LOOP
    v_produto_id := (v_item->>'produtoId')::integer;
    v_quantidade := (v_item->>'quantidade')::integer;
    v_item_sub_total := round((v_item->>'subTotal')::numeric, 2);
    v_item_valor_total := round((v_item->>'valorTotal')::numeric, 2);
    v_item_valor_desconto := round(coalesce(nullif(v_item->>'valorDesconto', '')::numeric, 0), 2);
    v_item_tipo_desconto := nullif(v_item->>'tipoDesconto', '')::public.enum_tipo_desconto_venda;
    v_item_valor_frete := round(coalesce(nullif(v_item->>'valorFrete', '')::numeric, 0), 2);
    v_item_desconto_aplicado := CASE
      WHEN v_item_tipo_desconto::text = 'PORCENTAGEM'
        THEN round(v_item_sub_total * least(v_item_valor_desconto, 100) / 100, 2)
      WHEN v_item_tipo_desconto::text = 'FIXO'
        THEN least(v_item_sub_total, v_item_valor_desconto)
      ELSE 0
    END;

    IF v_produto_id IS NULL OR v_quantidade IS NULL OR v_quantidade <= 0
       OR v_item_sub_total < 0 OR v_item_valor_total < 0
       OR v_item_valor_desconto < 0 OR v_item_valor_frete < 0
       OR (v_item_tipo_desconto::text = 'PORCENTAGEM' AND v_item_valor_desconto > 100)
       OR v_item_valor_total <> round(v_item_sub_total - v_item_desconto_aplicado + v_item_valor_frete, 2) THEN
      RAISE EXCEPTION 'Dados inválidos em um dos itens da venda.' USING ERRCODE = 'P0001';
    END IF;

    IF v_baixar_estoque THEN
      PERFORM public.fn_baixa_estoque_produto(v_produto_id, v_quantidade);
    END IF;

    INSERT INTO public.vendaproduto (
      venda_id, produtoid, quantidade, sub_total, valor_total,
      valor_desconto, tipo_desconto, valor_frete
    ) VALUES (
      v_venda_id, v_produto_id, v_quantidade, v_item_sub_total, v_item_valor_total,
      v_item_valor_desconto, v_item_tipo_desconto, v_item_valor_frete
    );

    IF v_baixar_estoque THEN
      INSERT INTO public.vendaproduto_baixa (venda_id, produtoid, quantidade, updated_at)
      VALUES (v_venda_id, v_produto_id, v_quantidade, now())
      ON CONFLICT (venda_id, produtoid) DO UPDATE
        SET quantidade = excluded.quantidade, updated_at = now();
    END IF;
  END LOOP;

  RETURN v_venda_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_editar_venda_com_itens(
  p_venda_id integer,
  p_itens jsonb,
  p_sub_total numeric,
  p_valor_total numeric,
  p_desconto_tipo text DEFAULT NULL,
  p_desconto_valor numeric DEFAULT 0,
  p_valor_frete numeric DEFAULT 0,
  p_updated_by uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_tinha_baixa boolean;
  v_item jsonb;
  v_produto_id integer;
  v_quantidade integer;
  v_sub_total numeric(14,2);
  v_valor_total numeric(14,2);
  v_valor_desconto numeric(14,2);
  v_tipo_desconto public.enum_tipo_desconto_venda;
  v_desconto_aplicado numeric(14,2);
  v_valor_frete_item numeric(14,2);
  v_ids_solicitados integer;
  v_ids_encontrados integer;
  v_soma_itens numeric(14,2);
BEGIN
  SELECT status::text
    INTO v_status
    FROM public.venda
   WHERE id = p_venda_id
   FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_status IN ('PAGO', 'FINALIZADA', 'CANCELADA', 'CANCELADO') THEN
    RAISE EXCEPTION 'Os itens não podem ser alterados em uma venda paga, finalizada ou cancelada.'
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.nfe WHERE vendaid = p_venda_id) THEN
    RAISE EXCEPTION 'Exclua a NF-e em rascunho antes de alterar os itens da venda.'
      USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'A venda deve possuir ao menos um item.' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(DISTINCT (value->>'produtoId')::integer)
    INTO v_ids_solicitados
    FROM jsonb_array_elements(p_itens);
  SELECT count(*)
    INTO v_ids_encontrados
    FROM public.produto
   WHERE id IN (
     SELECT DISTINCT (value->>'produtoId')::integer FROM jsonb_array_elements(p_itens)
   );
  IF v_ids_solicitados <> v_ids_encontrados THEN
    RAISE EXCEPTION 'Um ou mais produtos não existem.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
    FROM public.produto
   WHERE id IN (
     SELECT DISTINCT (value->>'produtoId')::integer FROM jsonb_array_elements(p_itens)
   )
   ORDER BY id
   FOR UPDATE;

  SELECT round(coalesce(sum((value->>'subTotal')::numeric), 0), 2)
    INTO v_soma_itens
    FROM jsonb_array_elements(p_itens);
  IF v_soma_itens <> round(coalesce(p_sub_total, 0), 2) THEN
    RAISE EXCEPTION 'O subtotal da venda não corresponde à soma dos itens.' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(p_sub_total, 0) < 0 OR coalesce(p_valor_total, 0) < 0
     OR coalesce(p_desconto_valor, 0) < 0 OR coalesce(p_valor_frete, 0) < 0 THEN
    RAISE EXCEPTION 'Os valores financeiros da venda não podem ser negativos.' USING ERRCODE = 'P0001';
  END IF;

  v_tinha_baixa := EXISTS (
    SELECT 1 FROM public.vendaproduto_baixa WHERE venda_id = p_venda_id
  );
  IF v_tinha_baixa THEN
    PERFORM public.fn_estornar_estoque_venda(p_venda_id);
  END IF;

  DELETE FROM public.vendaproduto WHERE venda_id = p_venda_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_produto_id := (v_item->>'produtoId')::integer;
    v_quantidade := (v_item->>'quantidade')::integer;
    v_sub_total := round((v_item->>'subTotal')::numeric, 2);
    v_valor_total := round((v_item->>'valorTotal')::numeric, 2);
    v_valor_desconto := round(coalesce(nullif(v_item->>'valorDesconto', '')::numeric, 0), 2);
    v_tipo_desconto := nullif(v_item->>'tipoDesconto', '')::public.enum_tipo_desconto_venda;
    v_valor_frete_item := round(coalesce(nullif(v_item->>'valorFrete', '')::numeric, 0), 2);
    v_desconto_aplicado := CASE
      WHEN v_tipo_desconto::text = 'PORCENTAGEM'
        THEN round(v_sub_total * least(v_valor_desconto, 100) / 100, 2)
      WHEN v_tipo_desconto::text = 'FIXO'
        THEN least(v_sub_total, v_valor_desconto)
      ELSE 0
    END;

    IF v_produto_id IS NULL OR v_quantidade IS NULL OR v_quantidade <= 0
       OR v_sub_total < 0 OR v_valor_total < 0 OR v_valor_desconto < 0
       OR v_valor_frete_item < 0
       OR (v_tipo_desconto::text = 'PORCENTAGEM' AND v_valor_desconto > 100)
       OR v_valor_total <> round(v_sub_total - v_desconto_aplicado + v_valor_frete_item, 2) THEN
      RAISE EXCEPTION 'Dados inválidos em um dos itens da venda.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.vendaproduto (
      venda_id, produtoid, quantidade, sub_total, valor_total,
      valor_desconto, tipo_desconto, valor_frete
    ) VALUES (
      p_venda_id, v_produto_id, v_quantidade, v_sub_total, v_valor_total,
      v_valor_desconto, v_tipo_desconto, v_valor_frete_item
    );
  END LOOP;

  UPDATE public.venda
     SET sub_total = round(p_sub_total, 2),
         valortotal = round(p_valor_total, 2),
         desconto_tipo = nullif(p_desconto_tipo, '')::public.enum_tipo_desconto_venda,
         desconto_valor = round(coalesce(p_desconto_valor, 0), 2),
         valor_frete = round(coalesce(p_valor_frete, 0), 2),
         updated_by = coalesce(p_updated_by, updated_by),
         updatedat = now()
   WHERE id = p_venda_id;

  IF v_tinha_baixa THEN
    PERFORM public.fn_baixar_estoque_venda(p_venda_id);
  END IF;
END;
$$;

ALTER FUNCTION public.fn_criar_venda_com_itens(jsonb) OWNER TO postgres;
ALTER FUNCTION public.fn_editar_venda_com_itens(integer, jsonb, numeric, numeric, text, numeric, numeric, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.fn_criar_venda_com_itens(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_editar_venda_com_itens(integer, jsonb, numeric, numeric, text, numeric, numeric, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_criar_venda_com_itens(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_editar_venda_com_itens(integer, jsonb, numeric, numeric, text, numeric, numeric, uuid)
  TO service_role;

COMMIT;
