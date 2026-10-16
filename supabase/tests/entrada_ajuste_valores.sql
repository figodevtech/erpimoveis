-- Executado pelo runner dentro de BEGIN/ROLLBACK, inclusive a migration.
DO $test$
DECLARE
  v_fornecedor bigint;
  v_autor uuid;
  v_produto integer;
  v_item integer;
  v_entrada bigint;
  v_posterior bigint;
  v_uso bigint;
  v_linha bigint;
  v_uso_linha bigint;
  v_resultado jsonb;
  v_contexto jsonb;
  v_versao text;
  v_transacoes jsonb;
  v_tx_snapshot jsonb;
  v_movimentos integer;
  v_saldo integer;
  v_rejeitou boolean;
  v_chave text := '00000000000000000000000000000000000991550001';
BEGIN
  SELECT id INTO v_fornecedor FROM public.fornecedor ORDER BY id LIMIT 1;
  SELECT id INTO v_autor FROM public.usuario ORDER BY id LIMIT 1;
  IF v_fornecedor IS NULL OR v_autor IS NULL THEN RAISE EXCEPTION 'Teste exige fornecedor e usuário.'; END IF;
  INSERT INTO public.produto(titulo, precovenda, estoque) VALUES ('TESTE AJUSTE DE ENTRADA', 2000, 0)
    RETURNING id INTO v_produto;
  v_resultado := public.registrar_entrada_confirmada(jsonb_build_object(
    'fornecedorid', v_fornecedor, 'fiscal', true, 'notachave', v_chave,
    'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO', 'valor_total_documento', 530, 'created_by', v_autor),
    jsonb_build_array(jsonb_build_object('produto_id', v_produto, 'quantidade', 1,
      'valor_unitario_compra', 500, 'numero_item_fiscal', 1)), '[]');
  v_entrada := (v_resultado->>'entrada_id')::bigint;
  SELECT id INTO v_linha FROM public.entradaitens WHERE entrada_id = v_entrada;
  SELECT count(*) INTO v_movimentos FROM public.estoque_movimento_entrada WHERE entrada_id = v_entrada;
  SELECT estoque INTO v_saldo FROM public.produto WHERE id = v_produto;
  v_resultado := public.ajustar_valores_entrada('produto', v_entrada,
    jsonb_build_array(jsonb_build_object('id', v_linha, 'valorUnitarioCompra', 1500)), 'Custo real da compra', 0, v_autor);
  IF (v_resultado->>'valor_total')::numeric <> 1530 THEN RAISE EXCEPTION 'Acréscimo do cabeçalho foi perdido.'; END IF;
  IF (SELECT valor_total_original FROM public.entrada WHERE id = v_entrada) <> 530
    OR (SELECT valor_unitario_compra_original FROM public.entradaitens WHERE id = v_linha) <> 500 THEN
    RAISE EXCEPTION 'Referência original não foi congelada.';
  END IF;
  IF (SELECT ultimovalordecompra FROM public.produto WHERE id = v_produto) <> 1500 THEN
    RAISE EXCEPTION 'Custo atual não foi atualizado.';
  END IF;
  IF (SELECT estoque FROM public.produto WHERE id = v_produto) <> v_saldo
    OR (SELECT count(*) FROM public.estoque_movimento_entrada WHERE entrada_id = v_entrada) <> v_movimentos THEN
    RAISE EXCEPTION 'Ajuste movimentou quantidades.';
  END IF;
  -- Revisão antiga e item de outra entrada são rejeitados sem escrita parcial.
  v_rejeitou := false;
  BEGIN
    PERFORM public.ajustar_valores_entrada('produto', v_entrada,
      jsonb_build_array(jsonb_build_object('id', v_linha, 'valorUnitarioCompra', 1700)), 'Concorrência', 0, v_autor);
  EXCEPTION WHEN serialization_failure THEN v_rejeitou := true; END;
  IF NOT v_rejeitou THEN RAISE EXCEPTION 'Aceitou revisão antiga.'; END IF;
  v_contexto := public.contexto_valores_entrada('produto', v_entrada);
  v_versao := v_contexto->>'versao_financeiro';
  PERFORM public.ajustar_valores_entrada('produto', v_entrada,
    jsonb_build_array(jsonb_build_object('id', v_linha, 'valorUnitarioCompra', 1600)), 'Novo custo', 1, v_autor);
  v_transacoes := jsonb_build_array(jsonb_build_object('descricao', 'Compra ajustada', 'valor', 1530,
    'data', now(), 'categoria', 'DESPESAS OPERACIONAIS', 'pendente', true,
    'nomepagador', 'Fornecedor teste', 'cpfcnpjpagador', 'NAO INFORMADO'));
  v_rejeitou := false;
  BEGIN
    PERFORM public.registrar_financeiro_entrada('produto', v_entrada, v_transacoes, v_versao, v_autor);
  EXCEPTION WHEN serialization_failure THEN v_rejeitou := true; END;
  IF NOT v_rejeitou THEN RAISE EXCEPTION 'Financeiro aceitou revisão antiga.'; END IF;
  v_contexto := public.contexto_valores_entrada('produto', v_entrada);
  v_transacoes := jsonb_set(v_transacoes, '{0,valor}', '1630');
  PERFORM public.registrar_financeiro_entrada('produto', v_entrada, v_transacoes,
    v_contexto->>'versao_financeiro', v_autor);
  SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO v_tx_snapshot FROM public.transacao t WHERE entrada_id = v_entrada;
  PERFORM public.ajustar_valores_entrada('produto', v_entrada,
    jsonb_build_array(jsonb_build_object('id', v_linha, 'valorUnitarioCompra', 1800)), 'Preservar parcelas', 2, v_autor);
  IF (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.transacao t WHERE entrada_id = v_entrada) <> v_tx_snapshot THEN
    RAISE EXCEPTION 'Ajuste alterou transação pendente.';
  END IF;
  -- Pagamento existente também fica integralmente igual.
  UPDATE public.transacao SET pendente = false WHERE entrada_id = v_entrada;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO v_tx_snapshot FROM public.transacao t WHERE entrada_id = v_entrada;
  PERFORM public.ajustar_valores_entrada('produto', v_entrada,
    jsonb_build_array(jsonb_build_object('id', v_linha, 'valorUnitarioCompra', 500)), 'Restaurar original', 3, v_autor);
  IF (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.transacao t WHERE entrada_id = v_entrada) <> v_tx_snapshot THEN
    RAISE EXCEPTION 'Ajuste alterou transação paga.';
  END IF;
  IF (SELECT valor_total FROM public.entrada WHERE id = v_entrada) <> 530 THEN RAISE EXCEPTION 'Restauração divergiu.'; END IF;
  v_rejeitou := false;
  BEGIN
    UPDATE public.entrada_valor_ajuste SET motivo = 'adulterado' WHERE entrada_id = v_entrada;
  EXCEPTION WHEN check_violation THEN v_rejeitou := true; END;
  IF NOT v_rejeitou THEN RAISE EXCEPTION 'Auditoria aceitou alteração.'; END IF;
  -- Uma compra posterior deve continuar determinando o custo do cadastro.
  v_resultado := public.registrar_entrada_confirmada(jsonb_build_object('fornecedorid', v_fornecedor,
    'tipo', 'COMPRA_FORNECEDOR', 'origem', 'MANUAL'), jsonb_build_array(jsonb_build_object(
      'produto_id', v_produto, 'quantidade', 1, 'valor_unitario_compra', 2000)), '[]');
  v_posterior := (v_resultado->>'entrada_id')::bigint;
  UPDATE public.entrada SET created_at = created_at + interval '1 second' WHERE id = v_posterior;
  PERFORM public.ajustar_valores_entrada('produto', v_entrada,
    jsonb_build_array(jsonb_build_object('id', v_linha, 'valorUnitarioCompra', 1200)), 'Ajuste histórico', 4, v_autor);
  IF (SELECT ultimovalordecompra FROM public.produto WHERE id = v_produto) <> 2000 THEN
    RAISE EXCEPTION 'Ajuste antigo substituiu custo mais recente.';
  END IF;
  -- Uso/consumo e geral compartilham a tabela, mantendo a mesma regra.
  SELECT id INTO v_item FROM public.criar_item_usoconsumo(jsonb_build_object(
    'titulo', 'TESTE AJUSTE GERAL', 'escopo', 'GERAL', 'precocompra', 0), 0, v_autor);
  v_resultado := public.registrar_entrada_usoconsumo(jsonb_build_object('fornecedor_id', v_fornecedor,
    'fiscal', true, 'chave_nfe', v_chave, 'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO',
    'escopo', 'GERAL', 'created_by', v_autor), jsonb_build_array(jsonb_build_object(
      'item_id', v_item, 'quantidade', 3, 'valor_unitario_compra', 10.1111,
      'valor_desconto', 0.01, 'valor_frete', 2, 'outras_despesas', 1, 'numero_item_fiscal', 2)), '[]');
  v_uso := (v_resultado->>'entrada_id')::bigint;
  SELECT id INTO v_uso_linha FROM public.usoconsumo_entrada_item WHERE entrada_id = v_uso;
  PERFORM public.ajustar_valores_entrada('usoconsumo', v_uso,
    jsonb_build_array(jsonb_build_object('id', v_uso_linha, 'valorUnitarioCompra', 20.1234)), 'Custo geral', 0, v_autor);
  IF (SELECT valor_total FROM public.usoconsumo_entrada_item WHERE id = v_uso_linha) <> 63.36 THEN
    RAISE EXCEPTION 'Arredondamento com desconto/frete/despesas divergiu.';
  END IF;
  v_contexto := public.contexto_valores_entrada('usoconsumo', v_uso);
  IF (v_contexto->>'valor_total')::numeric <> 1230 + 63.36 THEN
    RAISE EXCEPTION 'Documento misto não consolidou os valores das duas entradas.';
  END IF;
  v_rejeitou := false;
  BEGIN
    PERFORM public.registrar_financeiro_entrada('usoconsumo', v_uso, v_transacoes,
      v_contexto->>'versao_financeiro', v_autor);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN v_rejeitou := true; END;
  IF NOT v_rejeitou THEN RAISE EXCEPTION 'Criou financeiro duplicado pela outra metade.'; END IF;
  -- Inválidos não devem deixar histórico nem atualizações parciais.
  v_rejeitou := false;
  BEGIN
    PERFORM public.ajustar_valores_entrada('usoconsumo', v_uso,
      jsonb_build_array(jsonb_build_object('id', v_uso_linha, 'valorUnitarioCompra', -1)), 'Inválido', 1, v_autor);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejeitou := true; END;
  IF NOT v_rejeitou THEN RAISE EXCEPTION 'Aceitou valor negativo.'; END IF;
  IF (SELECT count(*) FROM public.entrada_valor_ajuste WHERE usoconsumo_entrada_id = v_uso) <> 1 THEN
    RAISE EXCEPTION 'Falha deixou auditoria parcial.';
  END IF;
  IF has_function_privilege('anon', 'public.ajustar_valores_entrada(text,bigint,jsonb,text,integer,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.registrar_financeiro_entrada(text,bigint,jsonb,text,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC financeira exposta sem autorização da aplicação.';
  END IF;
  RAISE NOTICE 'OK: ajuste/restauração, centavos, financeiro pendente/pago, revisão, custos recentes, estoque geral, documento misto e auditoria.';
END;
$test$;

DO $novas$
DECLARE
  v_empresa bigint;
  v_fornecedor bigint;
  v_autor uuid;
  v_produto integer;
  v_geral integer;
  v_consumo integer;
  v_doc bigint;
  v_resultado jsonb;
  v_contexto jsonb;
  v_chave text;
  v_id bigint;
  v_uso bigint;
  v_qtd integer;
BEGIN
  SELECT id INTO v_empresa FROM public.empresa ORDER BY id LIMIT 1;
  SELECT id INTO v_fornecedor FROM public.fornecedor ORDER BY id LIMIT 1;
  SELECT id INTO v_autor FROM public.usuario ORDER BY id LIMIT 1;
  INSERT INTO public.produto(titulo, precovenda, estoque) VALUES ('NOVAS ENTRADAS COM AJUSTE', 200, 0)
    RETURNING id INTO v_produto;
  SELECT id INTO v_geral FROM public.criar_item_usoconsumo(jsonb_build_object(
    'titulo', 'AJUSTE CONSOLIDADO GERAL', 'escopo', 'GERAL', 'precocompra', 0), 0, v_autor);
  SELECT id INTO v_consumo FROM public.criar_item_usoconsumo(jsonb_build_object(
    'titulo', 'AJUSTE USO CONSUMO', 'escopo', 'USOCONSUMO', 'precocompra', 0), 0, v_autor);
  v_chave := '00000000000000000000000000000000000991550002';
  INSERT INTO public.fiscal_dfe_documento(empresa_id, nsu, schema, tipo_documento, chave_acesso, valor_total, xml, resumo)
    VALUES(v_empresa, '999999999915502', 'procNFe_teste', 'PROC_NFE', v_chave, 35, '<NFe/>', '{}') RETURNING id INTO v_doc;
  v_resultado := public.registrar_entrada_com_valores('PERSONALIZADA', jsonb_build_object(
    'p_destino', 'ESTOQUE', 'p_entrada', jsonb_build_object('fornecedorid', v_fornecedor,
      'fiscal', true, 'notachave', v_chave, 'fiscal_dfe_documento_id', v_doc,
      'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO', 'valor_total_documento', 35, 'created_by', v_autor),
    'p_item', jsonb_build_object('produto_id', v_produto, 'quantidade', 2, 'valor_unitario_compra', 15),
    'p_itens_fiscais', jsonb_build_array(jsonb_build_object('numero_item', 1, 'quantidade', 1, 'custo_estoque', 30)),
    'p_custo_total', 30), jsonb_build_object('motivo', 'Custo consolidado real', 'itens', jsonb_build_array(
      jsonb_build_object('inventory', 'produto', 'consolidado', true, 'valorUnitarioCompra', 20))),
    jsonb_build_array(jsonb_build_object('descricao', 'Compra consolidada', 'valor', 45,
      'data', now(), 'categoria', 'DESPESAS OPERACIONAIS', 'pendente', true,
      'nomepagador', 'Fornecedor teste', 'cpfcnpjpagador', 'NAO INFORMADO')), v_autor);
  v_id := (v_resultado->>'entrada_id')::bigint;
  IF (v_resultado->>'valor_total')::numeric <> 45 THEN RAISE EXCEPTION 'Nova personalizada: total incorreto.'; END IF;
  IF (SELECT custo_total_estoque FROM public.entrada_fiscal_personalizada WHERE entrada_id = v_id) <> 30 THEN
    RAISE EXCEPTION 'Ajuste adulterou snapshot fiscal consolidado.';
  END IF;
  IF (SELECT count(*) FROM public.transacao WHERE entrada_id = v_id AND valor = 45) <> 1 THEN
    RAISE EXCEPTION 'Personalizada não lançou financeiro ajustado.';
  END IF;
  -- Híbrida: linha normal de revenda + consolidado geral. Financeiro único.
  v_chave := '00000000000000000000000000000000000991550003';
  INSERT INTO public.fiscal_dfe_documento(empresa_id, nsu, schema, tipo_documento, chave_acesso, valor_total, xml, resumo)
    VALUES(v_empresa, '999999999915503', 'procNFe_teste', 'PROC_NFE', v_chave, 55, '<NFe/>', '{}') RETURNING id INTO v_doc;
  v_resultado := public.registrar_entrada_com_valores('HIBRIDA', jsonb_build_object(
    'p_entrada_produto', jsonb_build_object('fornecedorid', v_fornecedor, 'fiscal', true, 'notachave', v_chave,
      'fiscal_dfe_documento_id', v_doc, 'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO', 'created_by', v_autor),
    'p_itens_produto', jsonb_build_array(jsonb_build_object('produto_id', v_produto,
      'quantidade', 2, 'valor_unitario_compra', 10, 'numero_item_fiscal', 1)),
    'p_entrada_usoconsumo', jsonb_build_object('fornecedor_id', v_fornecedor, 'fiscal', true, 'chave_nfe', v_chave,
      'documento_fiscal_recebido_id', v_doc, 'escopo', 'GERAL', 'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO', 'created_by', v_autor),
    'p_itens_usoconsumo', jsonb_build_array(jsonb_build_object('item_id', v_geral, 'quantidade', 3, 'valor_unitario_compra', 10)),
    'p_apropriacoes', jsonb_build_array(jsonb_build_object('numero_item', 1, 'destino', 'PRODUTO', 'quantidade', 2),
      jsonb_build_object('numero_item', 2, 'destino', 'USOCONSUMO', 'quantidade', 1)),
    'p_auditoria', jsonb_build_object('destino', 'GERAL', 'usoconsumo_item_id', v_geral,
      'quantidade_personalizada', 3, 'custo_unitario', 10,
      'item_destino_snapshot', jsonb_build_object('id', v_geral, 'titulo', 'AJUSTE CONSOLIDADO GERAL', 'unidade', 'UN'),
      'itens_originais', jsonb_build_array(jsonb_build_object('numero_item', 2, 'quantidade', 1, 'custo_estoque', 30))),
    'p_custo_total', 50, 'p_custo_personalizado', 30, 'p_total_documento', 55),
    jsonb_build_object('motivo', 'Conferência da compra híbrida', 'itens', jsonb_build_array(
      jsonb_build_object('inventory', 'produto', 'numeroItemFiscal', 1, 'valorUnitarioCompra', 25),
      jsonb_build_object('inventory', 'usoconsumo', 'consolidado', true, 'valorUnitarioCompra', 20))),
    jsonb_build_array(jsonb_build_object('descricao', 'Compra híbrida ajustada', 'valor', 115,
      'data', now(), 'categoria', 'DESPESAS OPERACIONAIS', 'pendente', true,
      'nomepagador', 'Fornecedor teste', 'cpfcnpjpagador', 'NAO INFORMADO')), v_autor);
  v_id := (v_resultado->>'entrada_id')::bigint;
  v_uso := (v_resultado->>'usoconsumo_entrada_id')::bigint;
  IF (v_resultado->>'valor_total')::numeric <> 115 THEN RAISE EXCEPTION 'Nova híbrida: total incorreto.'; END IF;
  IF (SELECT count(*) FROM public.transacao WHERE entrada_id = v_id AND usoconsumo_entrada_id = v_uso AND valor = 115) <> 1 THEN
    RAISE EXCEPTION 'Híbrida não lançou financeiro único com total ajustado.';
  END IF;
  IF (SELECT count(*) FROM public.fiscal_dfe_item_apropriacao WHERE documento_id = v_doc AND cancelada_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'Híbrida perdeu apropriações fiscais.';
  END IF;
  -- Normal de uso/consumo: a resposta continua trazendo entrada_id.
  v_chave := '00000000000000000000000000000000000991550004';
  v_resultado := public.registrar_entrada_com_valores('USOCONSUMO', jsonb_build_object(
    'p_entrada', jsonb_build_object('fornecedor_id', v_fornecedor, 'fiscal', true, 'chave_nfe', v_chave,
      'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO', 'escopo', 'USOCONSUMO', 'created_by', v_autor),
    'p_itens', jsonb_build_array(jsonb_build_object('item_id', v_consumo, 'quantidade', 4,
      'valor_unitario_compra', 10, 'numero_item_fiscal', 1))),
    jsonb_build_object('motivo', 'Custo uso consumo', 'itens', jsonb_build_array(jsonb_build_object(
      'inventory', 'usoconsumo', 'numeroItemFiscal', 1, 'valorUnitarioCompra', 15))), '[]', v_autor);
  v_id := (v_resultado->>'entrada_id')::bigint;
  IF (SELECT valor_total FROM public.usoconsumo_entrada WHERE id = v_id) <> 60 THEN
    RAISE EXCEPTION 'Nova normal uso/consumo divergiu.';
  END IF;
  -- Falha financeira reverte também entrada, estoque e auditoria.
  SELECT estoque INTO v_qtd FROM public.produto WHERE id = v_produto;
  BEGIN
    PERFORM public.registrar_entrada_com_valores('PRODUTO', jsonb_build_object(
      'p_entrada', jsonb_build_object('fornecedorid', v_fornecedor, 'fiscal', true,
        'notachave', '00000000000000000000000000000000000991550005', 'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO'),
      'p_itens', jsonb_build_array(jsonb_build_object('produto_id', v_produto, 'quantidade', 1,
        'valor_unitario_compra', 10, 'numero_item_fiscal', 1))),
      jsonb_build_object('motivo', 'Falha teste', 'itens', jsonb_build_array(jsonb_build_object(
        'inventory', 'produto', 'numeroItemFiscal', 1, 'valorUnitarioCompra', 20))),
      jsonb_build_array(jsonb_build_object('valor', 1)), v_autor);
    RAISE EXCEPTION 'Aceitou financeiro diferente do total ajustado.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF (SELECT estoque FROM public.produto WHERE id = v_produto) <> v_qtd
    OR EXISTS(SELECT 1 FROM public.entrada WHERE notachave = '00000000000000000000000000000000000991550005') THEN
    RAISE EXCEPTION 'Falha deixou entrada ou saldo parcial.';
  END IF;
  RAISE NOTICE 'OK: novas entradas personalizadas, híbridas, uso/consumo, financeiro ajustado e rollback integral.';
  -- Normal de revenda: o exemplo 500 -> 1500 permanece sem financeiro.
  v_resultado := public.registrar_entrada_com_valores('PRODUTO', jsonb_build_object(
    'p_entrada', jsonb_build_object('fornecedorid', v_fornecedor, 'fiscal', true,
      'notachave', '00000000000000000000000000000000000991550006', 'valor_total_documento', 500,
      'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO', 'created_by', v_autor),
    'p_itens', jsonb_build_array(jsonb_build_object('produto_id', v_produto, 'quantidade', 1,
      'valor_unitario_compra', 500, 'numero_item_fiscal', 1))),
    jsonb_build_object('motivo', 'Custo real informado pelo usuário', 'itens', jsonb_build_array(jsonb_build_object(
      'inventory', 'produto', 'numeroItemFiscal', 1, 'valorUnitarioCompra', 1500))), '[]', v_autor);
  v_id := (v_resultado->>'entrada_id')::bigint;
  IF (v_resultado->>'valor_total')::numeric <> 1500 OR EXISTS(SELECT 1 FROM public.transacao WHERE entrada_id = v_id) THEN
    RAISE EXCEPTION 'Nova revenda não reproduziu o cenário 500 -> 1500 sem financeiro.';
  END IF;
  UPDATE public.entrada SET status = 'CANCELADA', cancelada_at = now(), cancelada_by = v_autor,
    motivo_cancelamento = 'Teste de bloqueio de ajuste' WHERE id = v_id;
  BEGIN
    PERFORM public.ajustar_valores_entrada('produto', v_id, jsonb_build_array(jsonb_build_object(
      'id', (SELECT id FROM public.entradaitens WHERE entrada_id = v_id), 'valorUnitarioCompra', 1700)), 'Cancelada', 1, v_autor);
    RAISE EXCEPTION 'Aceitou ajuste em entrada cancelada.';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  IF (public.contexto_valores_entrada('produto', v_id)->>'valor_total')::numeric <> 1500 THEN
    RAISE EXCEPTION 'Consulta de entrada cancelada perdeu valor registrado.';
  END IF;
  -- Mista normal: acréscimo no cabeçalho e parcelamento posterior compartilhado.
  v_chave := '00000000000000000000000000000000000991550007';
  v_resultado := public.registrar_entrada_com_valores('MISTA', jsonb_build_object(
    'p_entrada_produto', jsonb_build_object('fornecedorid', v_fornecedor, 'fiscal', true, 'notachave', v_chave,
      'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO', 'valor_total_documento', 35, 'created_by', v_autor),
    'p_itens_produto', jsonb_build_array(jsonb_build_object('produto_id', v_produto, 'quantidade', 1,
      'valor_unitario_compra', 10, 'numero_item_fiscal', 1)),
    'p_entrada_usoconsumo', jsonb_build_object('fornecedor_id', v_fornecedor, 'fiscal', true, 'chave_nfe', v_chave,
      'tipo', 'COMPRA_FORNECEDOR', 'origem', 'NFE_TERCEIRO', 'escopo', 'USOCONSUMO', 'created_by', v_autor),
    'p_itens_usoconsumo', jsonb_build_array(jsonb_build_object('item_id', v_consumo, 'quantidade', 1,
      'valor_unitario_compra', 20, 'numero_item_fiscal', 2))),
    jsonb_build_object('motivo', 'Conferência mista', 'itens', jsonb_build_array(jsonb_build_object(
      'inventory', 'produto', 'numeroItemFiscal', 1, 'valorUnitarioCompra', 20))), '[]', v_autor);
  v_id := (v_resultado->>'entrada_id')::bigint;
  v_uso := (v_resultado->>'usoconsumo_entrada_id')::bigint;
  IF (v_resultado->>'valor_total')::numeric <> 45 THEN RAISE EXCEPTION 'Nova mista perdeu acréscimo fiscal.'; END IF;
  v_contexto := public.contexto_valores_entrada('usoconsumo', v_uso);
  PERFORM public.registrar_financeiro_entrada('usoconsumo', v_uso,
    jsonb_build_array(
      jsonb_build_object('descricao', 'Compra - Parcela 1/2', 'valor', 20, 'data', now(),
        'categoria', 'DESPESAS OPERACIONAIS', 'pendente', true, 'nomepagador', 'Fornecedor teste', 'cpfcnpjpagador', 'NAO INFORMADO'),
      jsonb_build_object('descricao', 'Compra - Parcela 2/2', 'valor', 25, 'data', now(),
        'categoria', 'DESPESAS OPERACIONAIS', 'pendente', true, 'nomepagador', 'Fornecedor teste', 'cpfcnpjpagador', 'NAO INFORMADO')),
    v_contexto->>'versao_financeiro', v_autor);
  IF (SELECT count(*) FROM public.transacao WHERE entrada_id = v_id AND usoconsumo_entrada_id = v_uso) <> 2
    OR (SELECT count(DISTINCT parcelamento_id) FROM public.transacao WHERE entrada_id = v_id) <> 1 THEN
    RAISE EXCEPTION 'Parcelamento posterior não foi criado como um único grupo compartilhado.';
  END IF;
  RAISE NOTICE 'OK: nova revenda, entrada cancelada, nova mista, acréscimos e grupo de parcelas posterior.';
END;
$novas$;
