BEGIN;

ALTER TABLE public.venda
  ADD COLUMN IF NOT EXISTS valor_frete numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.nfe
  ADD COLUMN IF NOT EXISTS valor_frete numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.nfe_item
  ADD COLUMN IF NOT EXISTS valor_frete numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.venda DROP CONSTRAINT IF EXISTS venda_valor_frete_nonnegative;
ALTER TABLE public.venda
  ADD CONSTRAINT venda_valor_frete_nonnegative CHECK (valor_frete >= 0);

ALTER TABLE public.nfe DROP CONSTRAINT IF EXISTS nfe_valor_frete_nonnegative;
ALTER TABLE public.nfe
  ADD CONSTRAINT nfe_valor_frete_nonnegative CHECK (valor_frete >= 0);

ALTER TABLE public.nfe_item DROP CONSTRAINT IF EXISTS nfe_item_valor_frete_nonnegative;
ALTER TABLE public.nfe_item
  ADD CONSTRAINT nfe_item_valor_frete_nonnegative CHECK (valor_frete >= 0);

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

  SELECT coalesce(comissao_venda_percent, 0) INTO v_comissao
  FROM public.usuario WHERE id = v_created_by;

  IF v_baixar_estoque THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_venda->'itens') LOOP
      v_produto_id := (v_item->>'produtoId')::integer;
      v_quantidade := (v_item->>'quantidade')::integer;
      IF v_produto_id IS NULL OR v_quantidade IS NULL OR v_quantidade <= 0 THEN
        RAISE EXCEPTION 'Cada item deve possuir produtoId e quantidade > 0.' USING ERRCODE = 'P0001';
      END IF;
      PERFORM public.fn_baixa_estoque_produto(v_produto_id, v_quantidade);
    END LOOP;
  END IF;

  INSERT INTO public.venda (
    clienteid, created_by, vendedor, status, forma_pagamento, sub_total, valortotal,
    desconto_tipo, desconto_valor, valor_frete, datavenda,
    comissao_venda_percent_aplicada, categoriavendaid
  ) VALUES (
    v_cliente_id,
    v_created_by,
    coalesce(nullif(p_venda->>'vendedor', '')::uuid, v_created_by),
    v_status,
    nullif(p_venda->>'formaPagamento', ''),
    (p_venda->>'subTotal')::numeric,
    (p_venda->>'valorTotal')::numeric,
    nullif(p_venda->>'descontoTipo', '')::public.enum_tipo_desconto_venda,
    nullif(p_venda->>'descontoValor', '')::numeric,
    v_valor_frete,
    coalesce(nullif(p_venda->>'dataVenda', '')::timestamp, now()),
    v_comissao,
    nullif(p_venda->>'categoriaVendaId', '')::integer
  ) RETURNING id INTO v_venda_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_venda->'itens') LOOP
    v_produto_id := (v_item->>'produtoId')::integer;
    v_quantidade := (v_item->>'quantidade')::integer;
    INSERT INTO public.vendaproduto (
      venda_id, produtoid, quantidade, sub_total, valor_total, valor_desconto, tipo_desconto
    ) VALUES (
      v_venda_id, v_produto_id, v_quantidade,
      (v_item->>'subTotal')::numeric, (v_item->>'valorTotal')::numeric,
      nullif(v_item->>'valorDesconto', '')::numeric,
      nullif(v_item->>'tipoDesconto', '')::public.enum_tipo_desconto_venda
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

CREATE OR REPLACE FUNCTION public.atualizar_totais_nfe(p_nfe_id bigint)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.nfe
  SET
    total_produtos = coalesce((
      SELECT sum(ni.valor_total) FROM public.nfe_item ni WHERE ni.nfe_id = nfe.id
    ), 0),
    valor_frete = coalesce((
      SELECT sum(ni.valor_frete) FROM public.nfe_item ni WHERE ni.nfe_id = nfe.id
    ), 0),
    total_nfe = coalesce((
      SELECT sum(ni.valor_total + ni.valor_frete) FROM public.nfe_item ni WHERE ni.nfe_id = nfe.id
    ), 0),
    updatedat = now()
  WHERE id = p_nfe_id;
$$;

REVOKE ALL ON FUNCTION public.fn_criar_venda_com_itens(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_criar_venda_com_itens(jsonb) TO service_role;

COMMIT;
