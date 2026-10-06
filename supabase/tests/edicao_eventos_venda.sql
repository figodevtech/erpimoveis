-- Apenas fixtures de teste; o runner mantem tudo numa transacao revertida.
BEGIN;
DO $test$
DECLARE
  v_usuario uuid; v_outro uuid; v_cliente integer; v_produto integer;
  v_venda integer; v_item bigint; v_receita bigint; v_frete bigint; v_comissao bigint;
  v_id bigint; v_manual jsonb; v_antes jsonb; v_depois jsonb; v_grupo bigint;
  v_transacao bigint; v_erro boolean; v_tipo text; v_natureza text; v_status public.enum_status_venda;
BEGIN
  SELECT id INTO v_usuario FROM public.usuario WHERE ativo ORDER BY id LIMIT 1;
  SELECT id INTO v_outro FROM public.usuario WHERE ativo AND id <> v_usuario ORDER BY id LIMIT 1;
  SELECT id INTO v_cliente FROM public.cliente ORDER BY id LIMIT 1;
  SELECT id INTO v_produto FROM public.produto ORDER BY id LIMIT 1;
  IF v_outro IS NULL OR v_cliente IS NULL OR v_produto IS NULL THEN RAISE EXCEPTION 'Teste requer dois usuarios, cliente e produto.'; END IF;
  UPDATE public.usuario SET comissao_venda_percent = 10 WHERE id = v_usuario;
  UPDATE public.usuario SET comissao_venda_percent = 3 WHERE id = v_outro;
  INSERT INTO public.venda(clienteid,created_by,vendedor,status,sub_total,valortotal,valor_frete,desconto_valor,datavenda)
    VALUES(v_cliente,v_usuario,v_usuario,'ORCAMENTO',100,105,10,5,'2026-09-15 12:00:00-03') RETURNING id INTO v_venda;
  INSERT INTO public.vendaproduto(venda_id,produtoid,quantidade,sub_total,valor_total,custo_unitario_aplicado)
    VALUES(v_venda,v_produto,1,100,100,25) RETURNING id INTO v_item;
  UPDATE public.venda SET status = 'PAGAMENTO' WHERE id = v_venda;
  SELECT id INTO STRICT v_receita FROM public.eventos_financeiros WHERE source_type='VENDA' AND source_id=v_venda AND origem='PRODUTO' AND natureza='RECEITA';
  SELECT id INTO STRICT v_frete FROM public.eventos_financeiros WHERE source_type='VENDA' AND source_id=v_venda AND origem='FRETE' AND natureza='RECEITA';
  SELECT id INTO STRICT v_comissao FROM public.eventos_financeiros WHERE source_type='VENDA' AND source_id=v_venda AND origem='COMISSAO';

  -- Receitas automaticas: somente valor; proveniencia e textos preservados.
  SELECT to_jsonb(e) INTO v_antes FROM public.eventos_financeiros e WHERE id=v_receita;
  v_depois := public.editar_evento_financeiro_venda(v_venda,v_receita,'{"valor":123.456,"descricao":"FORJADO","detalhe":"FORJADO","natureza":"DESPESA"}',v_usuario);
  IF (v_depois->>'valor')::numeric <> 123.46 OR v_depois->>'descricao' <> v_antes->>'descricao'
    OR v_depois->>'detalhe' IS DISTINCT FROM v_antes->>'detalhe' OR (v_depois->>'is_manual')::boolean
    OR v_depois->>'competencia_em' <> v_antes->>'competencia_em' OR v_depois->>'chave_origem' <> v_antes->>'chave_origem'
    OR v_depois->>'natureza' <> 'RECEITA' OR v_depois->>'created_by' IS DISTINCT FROM v_antes->>'created_by' THEN
    RAISE EXCEPTION 'Snapshot automatico alterou campos protegidos.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.auditoria_evento WHERE tabela='eventos_financeiros' AND registro_id=v_receita::text
    AND operacao='UPDATE' AND usuario_id=v_usuario AND (dados_anteriores->>'valor')::numeric=100
    AND (dados_novos->>'valor')::numeric=123.46) THEN RAISE EXCEPTION 'Snapshot automatico sem auditoria de antes/depois e autor.'; END IF;
  PERFORM public.editar_evento_financeiro_venda(v_venda,v_frete,'{"valor":15,"descricao":"FORJADO"}',v_usuario);
  UPDATE public.vendaproduto SET sub_total=200,valor_total=200 WHERE id=v_item;
  PERFORM public.sincronizar_eventos_financeiros_venda(v_venda);
  IF (SELECT valor FROM public.eventos_financeiros WHERE id=v_receita) <> 200
    OR (SELECT valor FROM public.eventos_financeiros WHERE id=v_frete) <> 10
    OR (SELECT valortotal FROM public.venda WHERE id=v_venda) <> 105 THEN
    RAISE EXCEPTION 'Receitas nao recalculam pela origem ou edicao modificou total comercial.';
  END IF;
  -- Custos e descontos automaticos continuam protegidos.
  FOR v_id IN SELECT id FROM public.eventos_financeiros WHERE source_type='VENDA' AND source_id=v_venda
    AND natureza='DESPESA' AND origem IN ('PRODUTO','DESCONTO') LOOP
    v_erro := false;
    BEGIN PERFORM public.editar_evento_financeiro_venda(v_venda,v_id,'{"valor":1}',v_usuario);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro := true; END;
    IF NOT v_erro THEN RAISE EXCEPTION 'Despesa automatica permitiu edicao direta.'; END IF;
  END LOOP;

  -- Correcao de comissao espelha, congela e nao e avulso excluivel.
  SELECT to_jsonb(e) INTO v_antes FROM public.eventos_financeiros e WHERE id=v_comissao;
  v_depois := public.editar_evento_financeiro_venda(v_venda,v_comissao,'{"valor":37.125,"descricao":"FORJADO"}',v_usuario);
  IF (v_depois->>'valor')::numeric<>37.13 OR v_depois->>'descricao'<>v_antes->>'descricao'
    OR v_depois->>'chave_origem'<>'COMISSAO_VENDA' OR NOT (v_depois->>'is_manual')::boolean
    OR NOT EXISTS(SELECT 1 FROM public.venda_comissao WHERE vendaid=v_venda AND valor_comissao=37.13 AND valor_comissao_manual=37.13) THEN
    RAISE EXCEPTION 'Comissao ajustada nao espelhou ou mudou proveniencia/textos.';
  END IF;
  UPDATE public.venda SET valortotal=205 WHERE id=v_venda;
  PERFORM public.sincronizar_eventos_financeiros_venda(v_venda);
  IF (SELECT valor FROM public.eventos_financeiros WHERE id=v_comissao)<>37.13
    OR (SELECT valor_comissao FROM public.venda_comissao WHERE vendaid=v_venda)<>37.13 THEN RAISE EXCEPTION 'Recalculo apagou correcao de comissao.'; END IF;
  v_erro := false;
  BEGIN PERFORM public.alterar_evento_financeiro_manual_venda(v_venda,v_comissao,'EXCLUIR','{}',v_usuario);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Comissao corrigida ganhou exclusao de avulso.'; END IF;

  v_grupo := public.registrar_lancamento_de_eventos(jsonb_build_object('eventos_ids',jsonb_build_array(v_comissao),
    'created_by',v_usuario,'pendente',true,'metodopagamento','PIX','linhas',jsonb_build_array(
      jsonb_build_object('parcela',1,'total_parcelas',2,'valor',20,'vencimento_em',now()),
      jsonb_build_object('parcela',2,'total_parcelas',2,'valor',17.13,'vencimento_em',now()+interval '1 month'))));
  v_erro := false;
  BEGIN PERFORM public.editar_evento_financeiro_venda(v_venda,v_comissao,'{"valor":40}',v_usuario);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Comissao comprometida permitiu edicao.'; END IF;
  v_erro := false;
  BEGIN UPDATE public.venda SET vendedor=v_outro WHERE id=v_venda;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Comissao comprometida permitiu transferencia.'; END IF;
  -- Com o mesmo vendedor, recalc compara com o valor corrigido, e nao o teorico.
  PERFORM public.reconciliar_comissao_venda(v_venda);
  IF EXISTS(SELECT 1 FROM public.eventos_financeiros e JOIN public.transacao t ON e.source_type='TRANSACAO' AND e.source_id=t.id
    WHERE t.lancamento_id=v_grupo AND e.status<>'CANCELADO') THEN RAISE EXCEPTION 'Lancamento duplicou DRE.'; END IF;
  PERFORM public.excluir_lancamento_de_eventos(v_grupo,v_usuario);
  PERFORM public.editar_evento_financeiro_venda(v_venda,v_comissao,'{"valor":40}',v_usuario);
  UPDATE public.venda SET vendedor=v_outro WHERE id=v_venda;
  IF NOT EXISTS(SELECT 1 FROM public.venda_comissao WHERE vendaid=v_venda AND usuarioid=v_outro AND valor_comissao_manual IS NULL AND valor_comissao=5.85)
    OR NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE id=v_comissao AND usuarioid=v_outro AND valor=5.85 AND NOT is_manual)
    THEN RAISE EXCEPTION 'Transferencia nao descartou ajuste e reapurou pela nova taxa.'; END IF;
  PERFORM public.editar_evento_financeiro_venda(v_venda,v_comissao,'{"valor":0}',v_usuario);
  PERFORM public.reconciliar_comissao_venda(v_venda);
  IF NOT EXISTS(SELECT 1 FROM public.venda_comissao WHERE vendaid=v_venda AND valor_comissao=0 AND valor_comissao_manual=0)
    OR (SELECT pode_gerar_transacao FROM public.eventos_financeiros WHERE id=v_comissao) THEN RAISE EXCEPTION 'Correcao para zero nao foi preservada.'; END IF;

  -- Avulsos mantem textos/valor editaveis em todos os status comerciais.
  FOREACH v_status IN ARRAY enum_range(NULL::public.enum_status_venda) LOOP
    UPDATE public.venda SET status=v_status,motivo_cancelamento='Regressao de edicao' WHERE id=v_venda;
    FOREACH v_tipo IN ARRAY ARRAY['PRODUTO','SERVICO','CONSUMO'] LOOP
      FOREACH v_natureza IN ARRAY ARRAY['RECEITA','DESPESA'] LOOP
        IF v_tipo='CONSUMO' AND v_natureza='RECEITA' THEN CONTINUE; END IF;
        v_manual := public.criar_evento_financeiro_manual_venda(v_venda,v_natureza,v_tipo,'Titulo','Detalhe',15,v_usuario);
        v_id := (v_manual->>'id')::bigint;
        v_depois := public.editar_evento_financeiro_venda(v_venda,v_id,'{"valor":12.345,"descricao":" Ajustado ","detalhe":null}',v_outro);
        IF (v_depois->>'valor')::numeric<>12.35 OR v_depois->>'descricao'<>'Ajustado' OR v_depois->>'detalhe' IS NOT NULL
          OR v_depois->>'created_by'<>v_usuario::text OR v_depois->>'competencia_em'<>v_manual->>'competencia_em' THEN
          RAISE EXCEPTION 'Avulso nao editou corretamente em % / % / %.',v_status,v_tipo,v_natureza;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  -- Vínculo individual de receita: trava antes de editar e libera apos desfazer.
  v_manual := public.criar_evento_financeiro_manual_venda(v_venda,'RECEITA','SERVICO','Receita','',15,v_usuario);
  v_id := (v_manual->>'id')::bigint;
  INSERT INTO public.transacao(descricao,valor,"valorLiquido",data,tipo,pendente,categoria,nomepagador,cpfcnpjpagador,created_by,evento_financeiro_id)
    VALUES('Receita',15,15,now(),'RECEITA',true,'NAO RELACIONADO','Cliente','',v_usuario,v_id) RETURNING id INTO v_transacao;
  v_erro := false;
  BEGIN PERFORM public.editar_evento_financeiro_venda(v_venda,v_id,'{"valor":20}',v_usuario);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Receita vinculada foi editada.'; END IF;
  DELETE FROM public.transacao WHERE id=v_transacao;
  PERFORM public.editar_evento_financeiro_venda(v_venda,v_id,'{"valor":20}',v_usuario);
  IF has_function_privilege('anon','public.editar_evento_financeiro_venda(bigint,bigint,jsonb,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.editar_evento_financeiro_venda(bigint,bigint,jsonb,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.editar_evento_financeiro_venda(bigint,bigint,jsonb,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Permissoes incorretas na RPC de edicao.';
  END IF;
  RAISE NOTICE 'Edicao de snapshots/avulsos/comissao, auditoria, competencia, transferencia, parcelamento e DRE verificados.';
END;
$test$;
ROLLBACK;
