-- Liga cada processo que mexe em estoque ao razao criado em
-- 20260805180000_razao_movimento_estoque.sql, informando a origem e o documento
-- antes de alterar o saldo. Sem isso o gatilho grava tudo como NAO_IDENTIFICADA.
--
-- Duas tecnicas, escolhidas pelo que o processo sabe no momento da alteracao:
--
--   1) Quando o documento ja chega como parametro (cancelamentos, baixas de OS e
--      de venda), a funcao original e renomeada para _interna e passa a ser
--      chamada por uma casca fina que so define o contexto. A regra de negocio
--      nao e reescrita, entao nao ha risco de divergir da versao em producao.
--
--   2) Quando o documento so nasce dentro da funcao (registro de entrada, de
--      saida e criacao de venda), o corpo e reescrito para definir o contexto
--      logo apos obter o id.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Cascas de contexto
-- ---------------------------------------------------------------------------

-- Ordem de servico ---------------------------------------------------------

DO $$
BEGIN
  IF to_regprocedure('public.consumir_estoque_os_interna(integer)') IS NULL
     AND to_regprocedure('public.consumir_estoque_os(integer)') IS NOT NULL THEN
    ALTER FUNCTION public.consumir_estoque_os(integer) RENAME TO consumir_estoque_os_interna;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.consumir_estoque_os(p_os_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.estoque_definir_contexto('ORDEM_SERVICO', p_os_id::bigint, 'OS #' || p_os_id);
  PERFORM public.consumir_estoque_os_interna(p_os_id);
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.reaplicar_baixa_estoque_os_interna(integer)') IS NULL
     AND to_regprocedure('public.reaplicar_baixa_estoque_os(integer)') IS NOT NULL THEN
    ALTER FUNCTION public.reaplicar_baixa_estoque_os(integer) RENAME TO reaplicar_baixa_estoque_os_interna;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reaplicar_baixa_estoque_os(p_os_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.estoque_definir_contexto('ORDEM_SERVICO', p_os_id::bigint, 'OS #' || p_os_id);
  PERFORM public.reaplicar_baixa_estoque_os_interna(p_os_id);
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.estornar_baixa_estoque_os_interna(integer)') IS NULL
     AND to_regprocedure('public.estornar_baixa_estoque_os(integer)') IS NOT NULL THEN
    ALTER FUNCTION public.estornar_baixa_estoque_os(integer) RENAME TO estornar_baixa_estoque_os_interna;
  END IF;
END;
$$;

-- Chamada pelo gatilho ordemservico_status_estorno quando a OS e cancelada ou
-- tem o orcamento recusado. Mantendo o nome, o gatilho segue valendo.
CREATE OR REPLACE FUNCTION public.estornar_baixa_estoque_os(p_os_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.estoque_definir_contexto('ORDEM_SERVICO', p_os_id::bigint, 'OS #' || p_os_id || ' - estorno');
  PERFORM public.estornar_baixa_estoque_os_interna(p_os_id);
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.vincular_produto_avulso_os_interna(integer, bigint, integer)') IS NULL
     AND to_regprocedure('public.vincular_produto_avulso_os(integer, bigint, integer)') IS NOT NULL THEN
    ALTER FUNCTION public.vincular_produto_avulso_os(integer, bigint, integer)
      RENAME TO vincular_produto_avulso_os_interna;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.vincular_produto_avulso_os(
  p_ordem_id integer,
  p_avulso_id bigint,
  p_produto_id integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.estoque_definir_contexto('ORDEM_SERVICO', p_ordem_id::bigint, 'OS #' || p_ordem_id);
  PERFORM public.vincular_produto_avulso_os_interna(p_ordem_id, p_avulso_id, p_produto_id);
END;
$$;

-- Venda --------------------------------------------------------------------

DO $$
BEGIN
  IF to_regprocedure('public.fn_baixar_estoque_venda_interna(integer)') IS NULL
     AND to_regprocedure('public.fn_baixar_estoque_venda(integer)') IS NOT NULL THEN
    ALTER FUNCTION public.fn_baixar_estoque_venda(integer) RENAME TO fn_baixar_estoque_venda_interna;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_baixar_estoque_venda(p_venda_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.estoque_definir_contexto('VENDA', p_venda_id::bigint, 'Venda #' || p_venda_id);
  RETURN public.fn_baixar_estoque_venda_interna(p_venda_id);
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.fn_estornar_estoque_venda_interna(integer)') IS NULL
     AND to_regprocedure('public.fn_estornar_estoque_venda(integer)') IS NOT NULL THEN
    ALTER FUNCTION public.fn_estornar_estoque_venda(integer) RENAME TO fn_estornar_estoque_venda_interna;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_estornar_estoque_venda(p_venda_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.estoque_definir_contexto('VENDA', p_venda_id::bigint, 'Venda #' || p_venda_id || ' - estorno');
  RETURN public.fn_estornar_estoque_venda_interna(p_venda_id);
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.replicar_baixa_estoque_venda_interna(integer)') IS NULL
     AND to_regprocedure('public.replicar_baixa_estoque_venda(integer)') IS NOT NULL THEN
    ALTER FUNCTION public.replicar_baixa_estoque_venda(integer) RENAME TO replicar_baixa_estoque_venda_interna;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.replicar_baixa_estoque_venda_interna(integer)') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.replicar_baixa_estoque_venda(p_venda_id integer)
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      BEGIN
        PERFORM public.estoque_definir_contexto('VENDA', p_venda_id::bigint, 'Venda #' || p_venda_id);
        PERFORM public.replicar_baixa_estoque_venda_interna(p_venda_id);
      END;
      $body$;
    $fn$;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.fn_sincronizar_baixa_estoque_marketplace_interna(integer, integer, integer)') IS NULL
     AND to_regprocedure('public.fn_sincronizar_baixa_estoque_marketplace(integer, integer, integer)') IS NOT NULL THEN
    ALTER FUNCTION public.fn_sincronizar_baixa_estoque_marketplace(integer, integer, integer)
      RENAME TO fn_sincronizar_baixa_estoque_marketplace_interna;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sincronizar_baixa_estoque_marketplace(
  p_venda_id integer,
  p_produto_id integer,
  p_quantidade_alvo integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.estoque_definir_contexto('VENDA', p_venda_id::bigint, 'Venda #' || p_venda_id || ' (marketplace)');
  PERFORM public.fn_sincronizar_baixa_estoque_marketplace_interna(p_venda_id, p_produto_id, p_quantidade_alvo);
END;
$$;

-- Entrada e saida manual: cancelamentos -------------------------------------

DO $$
BEGIN
  IF to_regprocedure('public.cancelar_entrada_confirmada_interna(bigint, text, uuid)') IS NULL
     AND to_regprocedure('public.cancelar_entrada_confirmada(bigint, text, uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.cancelar_entrada_confirmada(bigint, text, uuid)
      RENAME TO cancelar_entrada_confirmada_interna;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_entrada_confirmada(
  p_entrada_id bigint,
  p_motivo text,
  p_cancelada_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.estoque_definir_contexto(
    'ENTRADA', p_entrada_id, 'Entrada #' || p_entrada_id || ' - cancelada', p_cancelada_by
  );
  RETURN public.cancelar_entrada_confirmada_interna(p_entrada_id, p_motivo, p_cancelada_by);
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.cancelar_entrada_fiscal_mista_interna(bigint, bigint, text, uuid)') IS NULL
     AND to_regprocedure('public.cancelar_entrada_fiscal_mista(bigint, bigint, text, uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.cancelar_entrada_fiscal_mista(bigint, bigint, text, uuid)
      RENAME TO cancelar_entrada_fiscal_mista_interna;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_entrada_fiscal_mista(
  p_entrada_id bigint,
  p_usoconsumo_entrada_id bigint,
  p_motivo text,
  p_cancelada_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.estoque_definir_contexto(
    'ENTRADA', p_entrada_id, 'Entrada #' || p_entrada_id || ' - cancelada', p_cancelada_by
  );
  RETURN public.cancelar_entrada_fiscal_mista_interna(
    p_entrada_id, p_usoconsumo_entrada_id, p_motivo, p_cancelada_by
  );
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.cancelar_saida_estoque_interna(bigint, text, uuid)') IS NULL
     AND to_regprocedure('public.cancelar_saida_estoque(bigint, text, uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.cancelar_saida_estoque(bigint, text, uuid)
      RENAME TO cancelar_saida_estoque_interna;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_saida_estoque(
  p_saida_id bigint,
  p_motivo text,
  p_cancelada_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.estoque_definir_contexto(
    'SAIDA_MANUAL', p_saida_id, 'Saida #' || p_saida_id || ' - cancelada', p_cancelada_by
  );
  RETURN public.cancelar_saida_estoque_interna(p_saida_id, p_motivo, p_cancelada_by);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Funcoes cujo documento nasce dentro delas
-- ---------------------------------------------------------------------------

-- 2.1) Registro de saida manual. Unica mudanca em relacao a versao anterior: a
-- definicao do contexto logo apos obter v_saida_id.
CREATE OR REPLACE FUNCTION public.registrar_saida_estoque(
  p_produto_id integer,
  p_quantidade integer,
  p_motivo text,
  p_observacao text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_produto public.produto%ROWTYPE;
  v_saida_id bigint;
  v_motivo text := upper(btrim(coalesce(p_motivo, '')));
  v_observacao text := nullif(btrim(p_observacao), '');
  v_saldo_anterior integer;
  v_saldo_resultante integer;
  v_custo numeric(14,4);
BEGIN
  IF p_produto_id IS NULL OR p_produto_id <= 0 THEN
    RAISE EXCEPTION 'Produto invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RAISE EXCEPTION 'A quantidade deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tipos_motivo_saida
    WHERE codigo = v_motivo AND ativo AND escopo IN ('PRODUTO', 'AMBOS')
  ) THEN
    RAISE EXCEPTION 'Motivo de saida invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_motivo = 'OUTRO' AND v_observacao IS NULL THEN
    RAISE EXCEPTION 'Informe a observacao para o motivo Outro.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_produto
  FROM public.produto
  WHERE id = p_produto_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  v_saldo_anterior := coalesce(v_produto.estoque, 0)::integer;
  IF v_saldo_anterior < p_quantidade THEN
    RAISE EXCEPTION 'Estoque insuficiente. Disponivel: %, solicitado: %.', v_saldo_anterior, p_quantidade
      USING ERRCODE = '23514';
  END IF;
  v_saldo_resultante := v_saldo_anterior - p_quantidade;
  v_custo := greatest(coalesce(v_produto.ultimovalordecompra, v_produto.precocompra, 0), 0);

  INSERT INTO public.estoque_saida (motivo, observacao, created_by)
  VALUES (v_motivo, v_observacao, p_created_by)
  RETURNING id INTO v_saida_id;

  INSERT INTO public.estoque_saida_item (
    saida_id, produto_id, quantidade, saldo_anterior, saldo_resultante, valor_custo_aplicado
  ) VALUES (
    v_saida_id, p_produto_id, p_quantidade, v_saldo_anterior, v_saldo_resultante, v_custo
  );

  PERFORM public.estoque_definir_contexto(
    'SAIDA_MANUAL', v_saida_id, 'Saida #' || v_saida_id || ' - ' || replace(v_motivo, '_', ' '), p_created_by
  );

  UPDATE public.produto
  SET estoque = v_saldo_resultante,
      updatedat = now()
  WHERE id = p_produto_id;

  RETURN jsonb_build_object(
    'saida_id', v_saida_id,
    'saldo_anterior', v_saldo_anterior,
    'saldo_resultante', v_saldo_resultante
  );
END;
$$;

-- 2.2) Criacao de venda com itens.
--
-- Alem do contexto, a ordem foi invertida: a venda passa a ser inserida antes da
-- baixa, porque so assim o id existe para carimbar o movimento. A troca e segura
-- porque tudo corre na mesma transacao - se a baixa falhar por falta de saldo, a
-- excecao desfaz a venda recem inserida junto.
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
  IF jsonb_typeof(p_venda->'itens') <> 'array' OR jsonb_array_length(p_venda->'itens') = 0 THEN
    RAISE EXCEPTION 'p_venda.itens deve possuir ao menos um item.' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(comissao_venda_percent, 0) INTO v_comissao
    FROM public.usuario WHERE id = v_created_by;

  INSERT INTO public.venda (
    clienteid, created_by, vendedor, status, forma_pagamento, sub_total, valortotal,
    desconto_tipo, desconto_valor, datavenda, comissao_venda_percent_aplicada,
    categoriavendaid
  ) VALUES (
    v_cliente_id, v_created_by, coalesce(nullif(p_venda->>'vendedor', '')::uuid, v_created_by), v_status,
    nullif(p_venda->>'formaPagamento', ''), (p_venda->>'subTotal')::numeric,
    (p_venda->>'valorTotal')::numeric,
    nullif(p_venda->>'descontoTipo', '')::public.enum_tipo_desconto_venda,
    nullif(p_venda->>'descontoValor', '')::numeric,
    coalesce(nullif(p_venda->>'dataVenda', '')::timestamp, now()), v_comissao,
    nullif(p_venda->>'categoriaVendaId', '')::integer
  ) RETURNING id INTO v_venda_id;

  IF v_baixar_estoque THEN
    PERFORM public.estoque_definir_contexto(
      'VENDA', v_venda_id::bigint, 'Venda #' || v_venda_id, v_created_by
    );

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_venda->'itens') LOOP
      v_produto_id := (v_item->>'produtoId')::integer;
      v_quantidade := (v_item->>'quantidade')::integer;
      IF v_produto_id IS NULL OR v_quantidade IS NULL OR v_quantidade <= 0 THEN
        RAISE EXCEPTION 'Cada item deve possuir produtoId e quantidade > 0.' USING ERRCODE = 'P0001';
      END IF;
      PERFORM public.fn_baixa_estoque_produto(v_produto_id, v_quantidade);
    END LOOP;
  END IF;

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

-- 2.3) Registro de entrada. So muda a definicao do contexto apos obter
-- v_entrada_id; o restante do corpo e identico a versao anterior.
-- Cobre tambem a entrada fiscal mista, que delega para esta funcao.
CREATE OR REPLACE FUNCTION public.registrar_entrada_confirmada(
  p_entrada jsonb, p_itens jsonb, p_transacoes jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entrada_id bigint;
  v_item jsonb;
  v_item_id bigint;
  v_produto public.produto%ROWTYPE;
  v_produto_id integer;
  v_quantidade integer;
  v_custo numeric(14,4);
  v_desconto numeric(14,2);
  v_frete numeric(14,2);
  v_outras numeric(14,2);
  v_total_item numeric(14,2);
  v_total numeric(14,2) := 0;
  v_total_documento numeric(14,2) := nullif(p_entrada->>'valor_total_documento', '')::numeric;
  v_total_financeiro numeric(14,2) := 0;
  v_transacao jsonb;
  v_chave text := nullif(regexp_replace(coalesce(p_entrada->>'notachave', ''), '\D', '', 'g'), '');
  v_fiscal boolean := coalesce((p_entrada->>'fiscal')::boolean, false);
  v_origem text := coalesce(nullif(p_entrada->>'origem', ''), 'MANUAL');
  v_created_by uuid := nullif(p_entrada->>'created_by', '')::uuid;
BEGIN
  IF jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item para a entrada.' USING ERRCODE = '22023';
  END IF;

  IF v_origem NOT IN ('AJUSTE_RAPIDO', 'MANUAL', 'NFE_TERCEIRO') THEN
    RAISE EXCEPTION 'Origem da entrada inválida.' USING ERRCODE = '22023';
  END IF;
  IF v_total_documento IS NOT NULL AND v_total_documento < 0 THEN
    RAISE EXCEPTION 'O total do documento fiscal não pode ser negativo.' USING ERRCODE = '22023';
  END IF;

  IF v_fiscal AND (v_chave IS NULL OR length(v_chave) <> 44) THEN
    RAISE EXCEPTION 'A entrada fiscal exige uma chave de acesso com 44 dígitos.' USING ERRCODE = '22023';
  END IF;
  IF v_fiscal AND nullif(p_entrada->>'fornecedorid', '') IS NULL THEN
    RAISE EXCEPTION 'A entrada fiscal exige um fornecedor vinculado.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.entrada (
    fornecedorid, fiscal, notachave, tipo, status, origem,
    numero_nota, serie_nota, data_emissao, fiscal_dfe_documento_id, valor_total,
    created_by, observacao
  ) VALUES (
    nullif(p_entrada->>'fornecedorid', '')::integer,
    v_fiscal,
    v_chave,
    coalesce(nullif(p_entrada->>'tipo', ''), 'COMPRA_FORNECEDOR'),
    'CONFIRMADA'::public.enum_status_entrada,
    v_origem,
    nullif(p_entrada->>'numero_nota', ''),
    nullif(p_entrada->>'serie_nota', ''),
    nullif(p_entrada->>'data_emissao', '')::timestamp with time zone,
    nullif(p_entrada->>'fiscal_dfe_documento_id', '')::bigint,
    0,
    v_created_by,
    nullif(btrim(coalesce(p_entrada->>'observacao', '')), '')
  ) RETURNING id INTO v_entrada_id;

  PERFORM public.estoque_definir_contexto(
    'ENTRADA', v_entrada_id, 'Entrada #' || v_entrada_id, v_created_by
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens)
  LOOP
    v_produto_id := nullif(v_item->>'produto_id', '')::integer;
    v_quantidade := nullif(v_item->>'quantidade', '')::integer;
    v_custo := nullif(v_item->>'valor_unitario_compra', '')::numeric;
    v_desconto := coalesce(nullif(v_item->>'valor_desconto', '')::numeric, 0);
    v_frete := coalesce(nullif(v_item->>'valor_frete', '')::numeric, 0);
    v_outras := coalesce(nullif(v_item->>'outras_despesas', '')::numeric, 0);

    IF v_produto_id IS NULL OR v_quantidade IS NULL OR v_quantidade <= 0 THEN
      RAISE EXCEPTION 'Produto e quantidade inteira positiva são obrigatórios.' USING ERRCODE = '22023';
    END IF;
    IF v_custo IS NULL OR v_custo < 0 OR v_desconto < 0 OR v_frete < 0 OR v_outras < 0 THEN
      RAISE EXCEPTION 'Os valores de compra do item são inválidos.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_produto FROM public.produto WHERE id = v_produto_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % não encontrado.', v_produto_id USING ERRCODE = 'P0002';
    END IF;

    v_total_item := round((v_quantidade * v_custo) - v_desconto + v_frete + v_outras, 2);
    IF v_total_item < 0 THEN
      RAISE EXCEPTION 'O total do item não pode ser negativo.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.entradaitens (
      entrada_id, produto_id, quantidade, precovenda, unidade,
      valor_unitario_compra, valor_desconto, valor_frete, outras_despesas, valor_total,
      ncm, cest, csosn, referencia, titulo, "cClassTrib", "cstIbs", "cstCbs",
      cst, aliquotaicms, cfop, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins
    ) VALUES (
      v_entrada_id, v_produto_id, v_quantidade, coalesce(v_produto.precovenda, 0),
      coalesce(nullif(v_item->>'unidade', '')::public.unidade_medida, v_produto.unidade, 'UN'),
      v_custo, v_desconto, v_frete, v_outras, v_total_item,
      coalesce(nullif(v_item->>'ncm', ''), v_produto.ncm),
      coalesce(nullif(v_item->>'cest', ''), v_produto.cest),
      coalesce(nullif(v_item->>'csosn', ''), v_produto.csosn),
      coalesce(nullif(v_item->>'referencia', ''), v_produto.referencia),
      coalesce(nullif(v_item->>'titulo', ''), v_produto.titulo),
      coalesce(nullif(v_item->>'cClassTrib', ''), v_produto."cClassTrib"),
      coalesce(nullif(v_item->>'cstIbs', ''), v_produto."cstIbs"),
      coalesce(nullif(v_item->>'cstCbs', ''), v_produto."cstCbs"),
      coalesce(nullif(v_item->>'cst', ''), v_produto.cst),
      coalesce(nullif(v_item->>'aliquotaicms', '')::numeric, v_produto.aliquotaicms),
      coalesce(nullif(v_item->>'cfop', ''), v_produto.cfop),
      coalesce(nullif(v_item->>'cst_pis', ''), v_produto.cst_pis),
      coalesce(nullif(v_item->>'aliquota_pis', '')::numeric, v_produto.aliquota_pis),
      coalesce(nullif(v_item->>'cst_cofins', ''), v_produto.cst_cofins),
      coalesce(nullif(v_item->>'aliquota_cofins', '')::numeric, v_produto.aliquota_cofins)
    ) RETURNING id INTO v_item_id;

    UPDATE public.produto
    SET estoque = coalesce(estoque, 0) + v_quantidade,
        ultimovalordecompra = v_custo,
        updatedat = now()
    WHERE id = v_produto_id;

    INSERT INTO public.estoque_movimento_entrada (
      entrada_id, entrada_item_id, produto_id, tipo, quantidade,
      saldo_anterior, saldo_resultante, valor_unitario_compra
    ) VALUES (
      v_entrada_id, v_item_id, v_produto_id, 'ENTRADA', v_quantidade,
      coalesce(v_produto.estoque, 0), coalesce(v_produto.estoque, 0) + v_quantidade, v_custo
    );

    v_total := v_total + v_total_item;
  END LOOP;

  UPDATE public.entrada
  SET valor_total = round(coalesce(v_total_documento, v_total), 2)
  WHERE id = v_entrada_id;

  IF p_transacoes IS NOT NULL AND jsonb_typeof(p_transacoes) = 'array'
     AND jsonb_array_length(p_transacoes) > 0 THEN
    SELECT round(coalesce(sum((value->>'valor')::numeric), 0), 2)
      INTO v_total_financeiro
    FROM jsonb_array_elements(p_transacoes);
    IF v_total_financeiro <> round(coalesce(v_total_documento, v_total), 2) THEN
      RAISE EXCEPTION 'A soma dos lançamentos financeiros (%) difere do total da entrada (%).',
        v_total_financeiro, round(coalesce(v_total_documento, v_total), 2) USING ERRCODE = '22023';
    END IF;

    FOR v_transacao IN SELECT value FROM jsonb_array_elements(p_transacoes)
    LOOP
      IF coalesce((v_transacao->>'valor')::numeric, 0) <= 0 THEN
        RAISE EXCEPTION 'O valor do lançamento financeiro deve ser positivo.' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.transacao (
        descricao, valor, "valorLiquido", data, metodopagamento, categoria, categoria_id,
        tipo, cliente_id, banco_id, nomepagador, cpfcnpjpagador, pendente,
        plano_de_conta_id, plano_de_conta, centro_custo_id, centro_custo, entrada_id
      ) VALUES (
        coalesce(nullif(v_transacao->>'descricao', ''), 'Compra de mercadorias'),
        (v_transacao->>'valor')::numeric,
        (v_transacao->>'valor')::numeric,
        coalesce(nullif(v_transacao->>'data', '')::timestamp with time zone, now()),
        nullif(v_transacao->>'metodopagamento', '')::public.metodo_pagamento,
        coalesce(nullif(v_transacao->>'categoria', ''), 'NÃO RELACIONADO'),
        nullif(v_transacao->>'categoria_id', '')::integer,
        'DESPESA'::public.tipos_transacao,
        NULL,
        nullif(v_transacao->>'banco_id', '')::bigint,
        coalesce(nullif(v_transacao->>'nomepagador', ''), 'Fornecedor'),
        coalesce(nullif(regexp_replace(v_transacao->>'cpfcnpjpagador', '\D', '', 'g'), ''), 'NÃO INFORMADO'),
        coalesce((v_transacao->>'pendente')::boolean, false),
        nullif(v_transacao->>'plano_de_conta_id', '')::integer,
        nullif(v_transacao->>'plano_de_conta', ''),
        nullif(v_transacao->>'centro_custo_id', '')::integer,
        nullif(v_transacao->>'centro_custo', ''),
        v_entrada_id
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'entrada_id', v_entrada_id,
    'valor_total', round(coalesce(v_total_documento, v_total), 2)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Sincronismo de estoque do orcamento da OS
--
-- Substitui o ajuste que hoje e feito em TypeScript no PUT de
-- /api/ordens/[id]/orcamento, que le o saldo e regrava o valor absoluto sem
-- travar a linha. Alem de carimbar o movimento, isso elimina a corrida entre
-- duas edicoes simultaneas do mesmo produto.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sincronizar_baixa_estoque_os_produto(
  p_os_id integer,
  p_produto_id integer,
  p_quantidade_alvo integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estoque integer;
  v_baixado integer := 0;
  v_delta integer;
BEGIN
  IF p_os_id IS NULL OR p_os_id <= 0 OR p_produto_id IS NULL OR p_produto_id <= 0 THEN
    RAISE EXCEPTION 'OS e produto sao obrigatorios.' USING ERRCODE = '22023';
  END IF;
  IF p_quantidade_alvo IS NULL OR p_quantidade_alvo < 0 THEN
    RAISE EXCEPTION 'Quantidade alvo invalida.' USING ERRCODE = '22023';
  END IF;

  SELECT estoque INTO v_estoque FROM public.produto WHERE id = p_produto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto % nao encontrado.', p_produto_id USING ERRCODE = 'P0002';
  END IF;

  SELECT quantidade INTO v_baixado
  FROM public.osproduto_baixa
  WHERE ordemservicoid = p_os_id AND produtoid = p_produto_id
  FOR UPDATE;

  v_baixado := coalesce(v_baixado, 0);
  v_delta := p_quantidade_alvo - v_baixado;

  IF v_delta <> 0 THEN
    IF v_delta > 0 AND coalesce(v_estoque, 0) < v_delta THEN
      RAISE EXCEPTION 'Estoque insuficiente. Disponivel: %, necessario: %.', coalesce(v_estoque, 0), v_delta
        USING ERRCODE = '23514';
    END IF;

    PERFORM public.estoque_definir_contexto('ORDEM_SERVICO', p_os_id::bigint, 'OS #' || p_os_id);

    UPDATE public.produto
    SET estoque = coalesce(estoque, 0) - v_delta,
        updatedat = now()
    WHERE id = p_produto_id;
  END IF;

  IF p_quantidade_alvo = 0 THEN
    DELETE FROM public.osproduto_baixa
    WHERE ordemservicoid = p_os_id AND produtoid = p_produto_id;
  ELSE
    INSERT INTO public.osproduto_baixa (ordemservicoid, produtoid, quantidade)
    VALUES (p_os_id, p_produto_id, p_quantidade_alvo)
    ON CONFLICT (ordemservicoid, produtoid) DO UPDATE
      SET quantidade = excluded.quantidade;
  END IF;
END;
$$;

ALTER FUNCTION public.sincronizar_baixa_estoque_os_produto(integer, integer, integer) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 4) Permissoes
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_assinatura text;
BEGIN
  FOREACH v_assinatura IN ARRAY ARRAY[
    'public.consumir_estoque_os(integer)',
    'public.reaplicar_baixa_estoque_os(integer)',
    'public.estornar_baixa_estoque_os(integer)',
    'public.vincular_produto_avulso_os(integer, bigint, integer)',
    'public.fn_baixar_estoque_venda(integer)',
    'public.fn_estornar_estoque_venda(integer)',
    'public.replicar_baixa_estoque_venda(integer)',
    'public.fn_sincronizar_baixa_estoque_marketplace(integer, integer, integer)',
    'public.cancelar_entrada_confirmada(bigint, text, uuid)',
    'public.cancelar_entrada_fiscal_mista(bigint, bigint, text, uuid)',
    'public.cancelar_saida_estoque(bigint, text, uuid)',
    'public.registrar_saida_estoque(integer, integer, text, text, uuid)',
    'public.registrar_entrada_confirmada(jsonb, jsonb, jsonb)',
    'public.fn_criar_venda_com_itens(jsonb)',
    'public.sincronizar_baixa_estoque_os_produto(integer, integer, integer)'
  ]
  LOOP
    IF to_regprocedure(v_assinatura) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', v_assinatura);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_assinatura);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_assinatura);
    END IF;
  END LOOP;
END;
$$;

-- As versoes _interna nunca devem ser chamadas de fora: quem as invoca direto
-- pula a definicao de contexto e volta a gerar movimento sem origem.
DO $$
DECLARE
  v_assinatura text;
BEGIN
  FOREACH v_assinatura IN ARRAY ARRAY[
    'public.consumir_estoque_os_interna(integer)',
    'public.reaplicar_baixa_estoque_os_interna(integer)',
    'public.estornar_baixa_estoque_os_interna(integer)',
    'public.vincular_produto_avulso_os_interna(integer, bigint, integer)',
    'public.fn_baixar_estoque_venda_interna(integer)',
    'public.fn_estornar_estoque_venda_interna(integer)',
    'public.replicar_baixa_estoque_venda_interna(integer)',
    'public.fn_sincronizar_baixa_estoque_marketplace_interna(integer, integer, integer)',
    'public.cancelar_entrada_confirmada_interna(bigint, text, uuid)',
    'public.cancelar_entrada_fiscal_mista_interna(bigint, bigint, text, uuid)',
    'public.cancelar_saida_estoque_interna(bigint, text, uuid)'
  ]
  LOOP
    IF to_regprocedure(v_assinatura) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_assinatura);
    END IF;
  END LOOP;
END;
$$;

COMMIT;
