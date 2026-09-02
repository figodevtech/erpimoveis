-- Regressao transacional da entrada fiscal hibrida.
BEGIN;

DO $test$
DECLARE
  v_empresa integer;
  v_fornecedor integer;
  v_produto_normal_1 integer;
  v_produto_normal_2 integer;
  v_produto_custom integer;
  v_item_geral integer;
  v_doc_produto bigint;
  v_doc_misto bigint;
  v_entrada bigint;
  v_entrada_mista bigint;
  v_uso_mista bigint;
  v_contagem integer;
  v_total numeric;
  v_aceitou boolean;
  v_chave_produto constant text := '00000000000000000000000000000000000931000001';
  v_chave_mista constant text := '00000000000000000000000000000000000931000002';
BEGIN
  IF to_regprocedure(
    'public.registrar_entrada_fiscal_hibrida(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,numeric,numeric,numeric,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'A RPC registrar_entrada_fiscal_hibrida nao existe.';
  END IF;

  SELECT id INTO v_empresa FROM public.empresa ORDER BY id LIMIT 1;
  SELECT id INTO v_fornecedor FROM public.fornecedor ORDER BY id LIMIT 1;
  IF v_empresa IS NULL OR v_fornecedor IS NULL THEN
    RAISE EXCEPTION 'O teste exige empresa e fornecedor cadastrados.';
  END IF;

  INSERT INTO public.produto(titulo, precovenda, estoque)
  VALUES ('HIBRIDA NORMAL 1', 1, 0) RETURNING id INTO v_produto_normal_1;
  INSERT INTO public.produto(titulo, precovenda, estoque)
  VALUES ('HIBRIDA NORMAL 2', 1, 0) RETURNING id INTO v_produto_normal_2;
  INSERT INTO public.produto(titulo, precovenda, estoque)
  VALUES ('MANGUEIRA HIBRIDA', 1, 0) RETURNING id INTO v_produto_custom;

  SELECT id INTO v_item_geral FROM public.criar_item_usoconsumo(
    jsonb_build_object('titulo', 'MANGUEIRA GERAL HIBRIDA', 'escopo', 'GERAL', 'precocompra', 0),
    0,
    null
  );

  INSERT INTO public.fiscal_dfe_documento(
    empresa_id, nsu, schema, tipo_documento, chave_acesso, valor_total, xml, resumo
  ) VALUES
    (v_empresa, '999999999931001', 'procNFe_teste', 'PROC_NFE', v_chave_produto, 70, '<NFe/>', '{}'::jsonb),
    (v_empresa, '999999999931002', 'procNFe_teste', 'PROC_NFE', v_chave_mista, 35, '<NFe/>', '{}'::jsonb);
  SELECT id INTO v_doc_produto FROM public.fiscal_dfe_documento WHERE chave_acesso = v_chave_produto;
  SELECT id INTO v_doc_misto FROM public.fiscal_dfe_documento WHERE chave_acesso = v_chave_mista;

  SELECT (public.registrar_entrada_fiscal_hibrida(
    jsonb_build_object(
      'fornecedorid', v_fornecedor, 'fiscal', true, 'notachave', v_chave_produto,
      'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO',
      'fiscal_dfe_documento_id', v_doc_produto, 'valor_total_documento', 70,
      'tributos', jsonb_build_array(jsonb_build_object(
        'tipo', 'ICMS_ST', 'natureza', 'DESPESA', 'valor', 10,
        'descricao', 'ICMS-ST na compra hibrida',
        'detalhe', 'Tributo fora do custo consolidado',
        'itens', jsonb_build_array(jsonb_build_object('numeroItem', 3, 'valor', 10))
      ))
    ),
    jsonb_build_array(
      jsonb_build_object('produto_id', v_produto_normal_1, 'quantidade', 1, 'valor_unitario_compra', 10.01, 'numero_item_fiscal', 1),
      jsonb_build_object('produto_id', v_produto_normal_2, 'quantidade', 2, 'valor_unitario_compra', 10.01, 'numero_item_fiscal', 2),
      jsonb_build_object('produto_id', v_produto_custom, 'quantidade', 300, 'valor_unitario_compra', 0.1001)
    ),
    '{}'::jsonb,
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('numero_item', 1, 'destino', 'PRODUTO', 'quantidade', 1),
      jsonb_build_object('numero_item', 2, 'destino', 'PRODUTO', 'quantidade', 2),
      jsonb_build_object('numero_item', 3, 'destino', 'PRODUTO', 'quantidade', 1),
      jsonb_build_object('numero_item', 4, 'destino', 'PRODUTO', 'quantidade', 1),
      jsonb_build_object('numero_item', 5, 'destino', 'PRODUTO', 'quantidade', 1)
    ),
    jsonb_build_object(
      'destino', 'ESTOQUE', 'produto_id', v_produto_custom,
      'quantidade_personalizada', 300, 'custo_unitario', 0.1001,
      'item_destino_snapshot', jsonb_build_object('id', v_produto_custom, 'titulo', 'MANGUEIRA HIBRIDA', 'unidade', 'UN'),
      'itens_originais', jsonb_build_array(
        jsonb_build_object('numero_item', 3, 'quantidade', 1, 'custo_estoque', 10.01),
        jsonb_build_object('numero_item', 4, 'quantidade', 1, 'custo_estoque', 10.01),
        jsonb_build_object('numero_item', 5, 'quantidade', 1, 'custo_estoque', 10.01)
      )
    ),
    60.06,
    30.03,
    70,
    jsonb_build_array(jsonb_build_object(
      'descricao', 'Compra hibrida produto', 'valor', 70, 'data', now(),
      'categoria', 'DESPESAS OPERACIONAIS', 'pendente', true,
      'nomepagador', 'Fornecedor teste', 'cpfcnpjpagador', 'NAO INFORMADO'
    ))
  )->>'entrada_id')::bigint INTO v_entrada;

  SELECT valor_total INTO v_total FROM public.entrada WHERE id = v_entrada;
  IF v_total <> 70 THEN RAISE EXCEPTION 'Cabecalho unico deveria valer vNF 70 e vale %.', v_total; END IF;
  SELECT round(sum(valor_total), 2) INTO v_total FROM public.entradaitens WHERE entrada_id = v_entrada;
  IF v_total <> 60.06 THEN RAISE EXCEPTION 'Custo fisico deveria valer 60.06 e vale %.', v_total; END IF;
  SELECT count(*) INTO v_contagem FROM public.fiscal_dfe_item_apropriacao
    WHERE documento_id = v_doc_produto AND cancelada_at IS NULL;
  IF v_contagem <> 5 THEN RAISE EXCEPTION 'Esperava 5 apropriacoes e encontrou %.', v_contagem; END IF;
  SELECT count(*) INTO v_contagem FROM public.entrada_fiscal_personalizada
    WHERE entrada_id = v_entrada AND modalidade = 'HIBRIDA'
      AND produto_id = v_produto_custom AND quantidade_personalizada = 300
      AND custo_total_estoque = 30.03 AND valor_fiscal_documento = 70;
  IF v_contagem <> 1 THEN RAISE EXCEPTION 'Auditoria hibrida de revenda divergiu.'; END IF;
  SELECT count(*) INTO v_contagem FROM public.transacao
    WHERE entrada_id = v_entrada AND usoconsumo_entrada_id IS NULL
      AND valor = 70 AND NOT is_deleted;
  IF v_contagem <> 1 THEN RAISE EXCEPTION 'Financeiro integral da entrada unica divergiu.'; END IF;
  SELECT count(*) INTO v_contagem FROM public.eventos_financeiros
    WHERE source_type = 'ENTRADA' AND source_id = v_entrada
      AND origem = 'ENTRADA_FISCAL' AND chave_origem = 'ICMS_ST'
      AND valor = 10 AND status = 'ATIVO';
  IF v_contagem <> 1 THEN RAISE EXCEPTION 'Tributo hibrido nao chegou uma unica vez a DRE.'; END IF;

  -- Produto normal e consolidacao no estoque geral: dois cabecalhos, um financeiro.
  SELECT (resultado->>'entrada_id')::bigint, (resultado->>'usoconsumo_entrada_id')::bigint
    INTO v_entrada_mista, v_uso_mista
    FROM (SELECT public.registrar_entrada_fiscal_hibrida(
      jsonb_build_object(
        'fornecedorid', v_fornecedor, 'fiscal', true, 'notachave', v_chave_mista,
        'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO',
        'fiscal_dfe_documento_id', v_doc_misto, 'valor_total_documento', 35
      ),
      jsonb_build_array(jsonb_build_object(
        'produto_id', v_produto_normal_1, 'quantidade', 1,
        'valor_unitario_compra', 10, 'numero_item_fiscal', 1
      )),
      jsonb_build_object(
        'escopo', 'GERAL', 'fornecedor_id', v_fornecedor, 'fiscal', true,
        'chave_nfe', v_chave_mista, 'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO',
        'documento_fiscal_recebido_id', v_doc_misto, 'valor_total_documento', 35
      ),
      jsonb_build_array(jsonb_build_object(
        'item_id', v_item_geral, 'quantidade', 3, 'valor_unitario_compra', 6.6667
      )),
      jsonb_build_array(
        jsonb_build_object('numero_item', 1, 'destino', 'PRODUTO', 'quantidade', 1),
        jsonb_build_object('numero_item', 2, 'destino', 'USOCONSUMO', 'quantidade', 1),
        jsonb_build_object('numero_item', 3, 'destino', 'USOCONSUMO', 'quantidade', 1)
      ),
      jsonb_build_object(
        'destino', 'GERAL', 'usoconsumo_item_id', v_item_geral,
        'quantidade_personalizada', 3, 'custo_unitario', 6.6667,
        'item_destino_snapshot', jsonb_build_object('id', v_item_geral, 'titulo', 'MANGUEIRA GERAL HIBRIDA', 'unidade', 'UN'),
        'itens_originais', jsonb_build_array(
          jsonb_build_object('numero_item', 2, 'quantidade', 1, 'custo_estoque', 10),
          jsonb_build_object('numero_item', 3, 'quantidade', 1, 'custo_estoque', 10)
        )
      ),
      30,
      20,
      35,
      jsonb_build_array(jsonb_build_object(
        'descricao', 'Compra hibrida mista', 'valor', 35, 'data', now(),
        'categoria', 'DESPESAS OPERACIONAIS', 'pendente', true,
        'nomepagador', 'Fornecedor teste', 'cpfcnpjpagador', 'NAO INFORMADO'
      ))
    ) AS resultado) chamada;

  SELECT valor_total INTO v_total FROM public.entrada WHERE id = v_entrada_mista;
  IF v_total <> 10 THEN RAISE EXCEPTION 'Metade produto deveria conservar custo 10 e vale %.', v_total; END IF;
  SELECT valor_total INTO v_total FROM public.usoconsumo_entrada WHERE id = v_uso_mista;
  IF v_total <> 20 THEN RAISE EXCEPTION 'Metade geral deveria conservar custo 20 e vale %.', v_total; END IF;
  SELECT count(*) INTO v_contagem FROM public.transacao
    WHERE entrada_id = v_entrada_mista AND usoconsumo_entrada_id = v_uso_mista
      AND valor = 35 AND NOT is_deleted;
  IF v_contagem <> 1 THEN RAISE EXCEPTION 'Financeiro compartilhado da entrada hibrida divergiu.'; END IF;
  SELECT count(*) INTO v_contagem FROM public.entrada_fiscal_personalizada
    WHERE usoconsumo_entrada_id = v_uso_mista AND modalidade = 'HIBRIDA'
      AND destino = 'GERAL' AND custo_total_estoque = 20;
  IF v_contagem <> 1 THEN RAISE EXCEPTION 'Auditoria da consolidacao geral divergiu.'; END IF;

  -- A mesma NF-e ativa nao aceita concorrencia ou repeticao.
  v_aceitou := false;
  BEGIN
    PERFORM public.registrar_entrada_fiscal_hibrida(
      jsonb_build_object('fiscal_dfe_documento_id', v_doc_produto),
      jsonb_build_array(jsonb_build_object('produto_id', v_produto_normal_1, 'quantidade', 1, 'valor_unitario_compra', 1, 'numero_item_fiscal', 1)),
      '{}'::jsonb, '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('numero_item', 1, 'destino', 'PRODUTO', 'quantidade', 1),
        jsonb_build_object('numero_item', 2, 'destino', 'PRODUTO', 'quantidade', 1)
      ),
      jsonb_build_object(
        'destino', 'ESTOQUE', 'produto_id', v_produto_custom, 'quantidade_personalizada', 1,
        'custo_unitario', 1, 'item_destino_snapshot', '{}'::jsonb,
        'itens_originais', jsonb_build_array(jsonb_build_object('numero_item', 2, 'quantidade', 1, 'custo_estoque', 1))
      ),
      2, 1, 2, '[]'::jsonb
    );
    v_aceitou := true;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF v_aceitou THEN RAISE EXCEPTION 'A NF-e ativa aceitou uma segunda entrada hibrida.'; END IF;

  PERFORM public.cancelar_entrada_fiscal_mista(
    v_entrada_mista, v_uso_mista, 'Teste cancelamento hibrido', null
  );
  SELECT count(*) INTO v_contagem FROM public.fiscal_dfe_item_apropriacao
    WHERE documento_id = v_doc_misto AND cancelada_at IS NULL;
  IF v_contagem <> 0 THEN RAISE EXCEPTION 'Cancelamento nao encerrou as apropriacoes hibridas.'; END IF;
  SELECT count(*) INTO v_contagem FROM public.entrada_fiscal_personalizada
    WHERE usoconsumo_entrada_id = v_uso_mista;
  IF v_contagem <> 1 THEN RAISE EXCEPTION 'Cancelamento apagou a auditoria hibrida.'; END IF;

  RAISE NOTICE 'OK: entrada fiscal hibrida reconciliada e validada.';
END;
$test$;

ROLLBACK;
