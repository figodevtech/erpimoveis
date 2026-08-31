-- Regressao transacional da entrada fiscal personalizada.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/entrada_fiscal_personalizada.sql
--
-- Tudo e desfeito no ROLLBACK final.

BEGIN;

DO $test$
DECLARE
  v_empresa integer;
  v_fornecedor integer;
  v_produto integer;
  v_item_uso integer;
  v_item_geral integer;
  v_doc_produto bigint;
  v_doc_uso bigint;
  v_doc_geral bigint;
  v_entrada bigint;
  v_entrada_reaberta bigint;
  v_uso_entrada bigint;
  v_geral_entrada bigint;
  v_saldo_inicial integer;
  v_total numeric;
  v_contagem integer;
  v_aceitou boolean;
  v_chave_produto constant text := '00000000000000000000000000000000000930000001';
  v_chave_uso constant text := '00000000000000000000000000000000000930000002';
  v_chave_geral constant text := '00000000000000000000000000000000000930000003';
  v_itens jsonb := jsonb_build_array(
    jsonb_build_object('numero_item', 1, 'codigo', 'PEDACO', 'descricao', 'Pedaco de mangueira', 'unidade', 'UN', 'quantidade', 2, 'valor_unitario', 10, 'valor_total', 20, 'custo_estoque', 20),
    jsonb_build_object('numero_item', 2, 'codigo', 'CONECTOR-A', 'descricao', 'Conector A', 'unidade', 'UN', 'quantidade', 1, 'valor_unitario', 15, 'valor_total', 15, 'custo_estoque', 15),
    jsonb_build_object('numero_item', 3, 'codigo', 'CONECTOR-B', 'descricao', 'Conector B', 'unidade', 'UN', 'quantidade', 1, 'valor_unitario', 15, 'valor_total', 15, 'custo_estoque', 15)
  );
BEGIN
  IF to_regprocedure('public.registrar_entrada_fiscal_personalizada(text,jsonb,jsonb,jsonb,numeric,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'A RPC registrar_entrada_fiscal_personalizada nao existe.';
  END IF;

  SELECT id INTO v_empresa FROM public.empresa ORDER BY id LIMIT 1;
  SELECT id INTO v_fornecedor FROM public.fornecedor ORDER BY id LIMIT 1;
  IF v_empresa IS NULL OR v_fornecedor IS NULL THEN
    RAISE EXCEPTION 'O teste exige ao menos uma empresa e um fornecedor cadastrados.';
  END IF;

  INSERT INTO public.produto(titulo, precovenda, estoque)
  VALUES ('MANGUEIRA PERSONALIZADA TESTE', 1, 0)
  RETURNING id INTO v_produto;

  SELECT id INTO v_item_uso FROM public.criar_item_usoconsumo(
    jsonb_build_object('titulo', 'MANGUEIRA USO TESTE', 'escopo', 'USOCONSUMO', 'precocompra', 0),
    0,
    null
  );
  SELECT id INTO v_item_geral FROM public.criar_item_usoconsumo(
    jsonb_build_object('titulo', 'MANGUEIRA GERAL TESTE', 'escopo', 'GERAL', 'precocompra', 0),
    0,
    null
  );

  INSERT INTO public.fiscal_dfe_documento(
    empresa_id, nsu, schema, tipo_documento, chave_acesso, valor_total, xml, resumo
  ) VALUES
    (v_empresa, '999999999930001', 'procNFe_teste', 'PROC_NFE', v_chave_produto, 60, '<NFe/>', '{}'::jsonb),
    (v_empresa, '999999999930002', 'procNFe_teste', 'PROC_NFE', v_chave_uso, 60, '<NFe/>', '{}'::jsonb),
    (v_empresa, '999999999930003', 'procNFe_teste', 'PROC_NFE', v_chave_geral, 60, '<NFe/>', '{}'::jsonb);

  SELECT id INTO v_doc_produto FROM public.fiscal_dfe_documento WHERE chave_acesso = v_chave_produto;
  SELECT id INTO v_doc_uso FROM public.fiscal_dfe_documento WHERE chave_acesso = v_chave_uso;
  SELECT id INTO v_doc_geral FROM public.fiscal_dfe_documento WHERE chave_acesso = v_chave_geral;

  SELECT estoque INTO v_saldo_inicial FROM public.produto WHERE id = v_produto;
  SELECT (public.registrar_entrada_fiscal_personalizada(
    'ESTOQUE',
    jsonb_build_object(
      'fornecedorid', v_fornecedor, 'fiscal', true, 'notachave', v_chave_produto,
      'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO',
      'fiscal_dfe_documento_id', v_doc_produto, 'valor_total_documento', 60,
      'tributos', jsonb_build_array(jsonb_build_object(
        'tipo', 'ICMS_ST', 'natureza', 'DESPESA', 'valor', 10,
        'descricao', 'ICMS-ST na compra personalizada',
        'detalhe', 'Tributo fora do custo consolidado', 'itens', '[]'::jsonb
      ))
    ),
    jsonb_build_object(
      'produto_id', v_produto, 'quantidade', 300, 'valor_unitario_compra', 0.1667,
      'valor_desconto', 0.01, 'valor_frete', 0, 'outras_despesas', 0
    ),
    v_itens,
    50,
    jsonb_build_array(jsonb_build_object(
      'descricao', 'Compra personalizada teste', 'valor', 60, 'data', now(),
      'categoria', 'DESPESAS OPERACIONAIS', 'pendente', true,
      'nomepagador', 'Fornecedor teste', 'cpfcnpjpagador', 'NAO INFORMADO'
    ))
  )->>'entrada_id')::bigint INTO v_entrada;

  SELECT estoque INTO v_contagem FROM public.produto WHERE id = v_produto;
  IF v_contagem <> v_saldo_inicial + 300 THEN
    RAISE EXCEPTION 'Revenda recebeu saldo %, esperado %.', v_contagem, v_saldo_inicial + 300;
  END IF;
  SELECT valor_total INTO v_total FROM public.entrada WHERE id = v_entrada;
  IF v_total <> 60 THEN RAISE EXCEPTION 'Cabecalho deveria valer 60 e vale %.', v_total; END IF;
  SELECT valor_total INTO v_total FROM public.entradaitens WHERE entrada_id = v_entrada;
  IF v_total <> 50 THEN RAISE EXCEPTION 'Custo fisico deveria valer 50 e vale %.', v_total; END IF;
  SELECT count(*) INTO v_contagem FROM public.fiscal_dfe_item_apropriacao
    WHERE entrada_id = v_entrada AND cancelada_at IS NULL;
  IF v_contagem <> 3 THEN RAISE EXCEPTION 'Esperava 3 apropriacoes e encontrou %.', v_contagem; END IF;
  SELECT count(*) INTO v_contagem FROM public.entrada_fiscal_personalizada
    WHERE entrada_id = v_entrada AND destino = 'ESTOQUE' AND custo_total_estoque = 50;
  IF v_contagem <> 1 THEN RAISE EXCEPTION 'Auditoria da revenda nao foi gravada.'; END IF;
  SELECT count(*) INTO v_contagem FROM public.transacao
    WHERE entrada_id = v_entrada AND valor = 60 AND NOT is_deleted;
  IF v_contagem <> 1 THEN RAISE EXCEPTION 'Financeiro integral da revenda nao foi gravado.'; END IF;
  SELECT count(*) INTO v_contagem FROM public.eventos_financeiros
    WHERE source_type = 'ENTRADA' AND source_id = v_entrada
      AND origem = 'ENTRADA_FISCAL' AND chave_origem = 'ICMS_ST'
      AND valor = 10 AND status = 'ATIVO';
  IF v_contagem <> 1 THEN RAISE EXCEPTION 'Tributo da entrada personalizada nao chegou a DRE.'; END IF;

  -- A mesma nota nao pode ser consolidada novamente enquanto ativa.
  v_aceitou := false;
  BEGIN
    PERFORM public.registrar_entrada_fiscal_personalizada(
      'ESTOQUE',
      jsonb_build_object(
        'fornecedorid', v_fornecedor, 'fiscal', true, 'notachave', v_chave_produto,
        'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO',
        'fiscal_dfe_documento_id', v_doc_produto, 'valor_total_documento', 60
      ),
      jsonb_build_object('produto_id', v_produto, 'quantidade', 1, 'valor_unitario_compra', 50),
      v_itens, 50, '[]'::jsonb
    );
    v_aceitou := true;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF v_aceitou THEN RAISE EXCEPTION 'A NF-e ativa aceitou uma segunda personalizacao.'; END IF;

  SELECT (public.registrar_entrada_fiscal_personalizada(
    'USOCONSUMO',
    jsonb_build_object(
      'escopo', 'USOCONSUMO', 'fornecedor_id', v_fornecedor, 'fiscal', true,
      'chave_nfe', v_chave_uso, 'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO',
      'documento_fiscal_recebido_id', v_doc_uso, 'valor_total_documento', 60
    ),
    jsonb_build_object('item_id', v_item_uso, 'quantidade', 4, 'valor_unitario_compra', 12.5),
    v_itens, 50, '[]'::jsonb
  )->>'usoconsumo_entrada_id')::bigint INTO v_uso_entrada;

  SELECT (public.registrar_entrada_fiscal_personalizada(
    'GERAL',
    jsonb_build_object(
      'escopo', 'GERAL', 'fornecedor_id', v_fornecedor, 'fiscal', true,
      'chave_nfe', v_chave_geral, 'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO',
      'documento_fiscal_recebido_id', v_doc_geral, 'valor_total_documento', 60
    ),
    jsonb_build_object('item_id', v_item_geral, 'quantidade', 9, 'valor_unitario_compra', 5.5556),
    v_itens, 50, '[]'::jsonb
  )->>'usoconsumo_entrada_id')::bigint INTO v_geral_entrada;

  SELECT estoque INTO v_contagem FROM public.usoconsumo_item WHERE id = v_item_uso;
  IF v_contagem <> 4 THEN RAISE EXCEPTION 'Uso/consumo recebeu saldo %, esperado 4.', v_contagem; END IF;
  SELECT estoque INTO v_contagem FROM public.usoconsumo_item WHERE id = v_item_geral;
  IF v_contagem <> 9 THEN RAISE EXCEPTION 'Geral recebeu saldo %, esperado 9.', v_contagem; END IF;
  SELECT count(*) INTO v_contagem FROM public.usoconsumo_entrada
    WHERE (id = v_uso_entrada AND escopo = 'USOCONSUMO' AND valor_total = 60)
       OR (id = v_geral_entrada AND escopo = 'GERAL' AND valor_total = 60);
  IF v_contagem <> 2 THEN RAISE EXCEPTION 'Cabecalho ou escopo dos estoques simples divergiu.'; END IF;
  SELECT count(*) INTO v_contagem FROM public.fiscal_dfe_item_apropriacao
    WHERE usoconsumo_entrada_id IN (v_uso_entrada, v_geral_entrada)
      AND cancelada_at IS NULL;
  IF v_contagem <> 6 THEN RAISE EXCEPTION 'Esperava 6 apropriacoes nos estoques simples e encontrou %.', v_contagem; END IF;

  SELECT count(*) INTO v_contagem
    FROM public.entrada_fiscal_personalizada
   WHERE (usoconsumo_entrada_id = v_uso_entrada AND destino = 'USOCONSUMO')
      OR (usoconsumo_entrada_id = v_geral_entrada AND destino = 'GERAL');
  IF v_contagem <> 2 THEN RAISE EXCEPTION 'Auditoria dos estoques simples nao foi gravada.'; END IF;

  -- Cancelamento reverte saldo/apropriacoes, preserva auditoria e libera reentrada.
  PERFORM public.cancelar_entrada_confirmada(v_entrada, 'Teste de cancelamento', null);
  SELECT count(*) INTO v_contagem FROM public.fiscal_dfe_item_apropriacao
    WHERE entrada_id = v_entrada AND cancelada_at IS NULL;
  IF v_contagem <> 0 THEN RAISE EXCEPTION 'Cancelamento nao encerrou as apropriacoes.'; END IF;
  SELECT count(*) INTO v_contagem FROM public.entrada_fiscal_personalizada WHERE entrada_id = v_entrada;
  IF v_contagem <> 1 THEN RAISE EXCEPTION 'Cancelamento apagou a auditoria.'; END IF;
  SELECT count(*) INTO v_contagem FROM public.eventos_financeiros
    WHERE source_type = 'ENTRADA' AND source_id = v_entrada
      AND chave_origem = 'ICMS_ST' AND status = 'CANCELADO';
  IF v_contagem <> 1 THEN RAISE EXCEPTION 'Cancelamento nao preservou a DRE como cancelada.'; END IF;

  SELECT (public.registrar_entrada_fiscal_personalizada(
    'ESTOQUE',
    jsonb_build_object(
      'fornecedorid', v_fornecedor, 'fiscal', true, 'notachave', v_chave_produto,
      'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO',
      'fiscal_dfe_documento_id', v_doc_produto, 'valor_total_documento', 60
    ),
    jsonb_build_object('produto_id', v_produto, 'quantidade', 1, 'valor_unitario_compra', 50),
    v_itens, 50, '[]'::jsonb
  )->>'entrada_id')::bigint INTO v_entrada_reaberta;
  IF v_entrada_reaberta IS NULL OR v_entrada_reaberta = v_entrada THEN
    RAISE EXCEPTION 'A reentrada apos cancelamento nao foi criada.';
  END IF;

  PERFORM public.cancelar_entrada_usoconsumo(v_uso_entrada, 'Teste de cancelamento', null);
  PERFORM public.cancelar_entrada_usoconsumo(v_geral_entrada, 'Teste de cancelamento', null);
  SELECT coalesce(sum(estoque), 0) INTO v_contagem FROM public.usoconsumo_item
    WHERE id IN (v_item_uso, v_item_geral);
  IF v_contagem <> 0 THEN RAISE EXCEPTION 'Cancelamento nao reverteu os estoques simples.'; END IF;

  RAISE NOTICE 'OK: entrada personalizada validada nos tres estoques.';
END;
$test$;

ROLLBACK;
