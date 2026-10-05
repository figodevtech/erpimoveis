-- Regressão completa, executada em transação revertida no banco de demonstração.
BEGIN;
DO $test$
DECLARE
  v_usuario uuid; v_cliente integer; v_produto integer;
  v_venda integer; v_item bigint; v_evento jsonb; v_id bigint; v_receita bigint;
  v_despesa bigint; v_grupo bigint; v_transacao bigint; v_automatico bigint;
  v_status public.enum_status_venda; v_tipo text; v_natureza text;
  v_erro boolean; v_total numeric; v_antes numeric; v_funcao text;
  v_competencia timestamptz := '2026-09-15 12:00:00-03';
BEGIN
  SELECT id INTO v_usuario FROM public.usuario WHERE ativo ORDER BY id LIMIT 1;
  SELECT id INTO v_cliente FROM public.cliente ORDER BY id LIMIT 1;
  SELECT id INTO v_produto FROM public.produto ORDER BY id LIMIT 1;
  IF v_usuario IS NULL OR v_cliente IS NULL OR v_produto IS NULL THEN RAISE EXCEPTION 'Teste requer usuário, cliente e produto.'; END IF;

  -- Enum real, incluindo status legados e encerrados. Mesmo CRUD para todos.
  FOREACH v_status IN ARRAY enum_range(NULL::public.enum_status_venda) LOOP
    INSERT INTO public.venda(clienteid,created_by,status,sub_total,valortotal,datavenda,motivo_cancelamento)
      VALUES(v_cliente,v_usuario,v_status,0,0,v_competencia,'Regressão de eventos manuais') RETURNING id INTO v_venda;
    FOREACH v_tipo IN ARRAY ARRAY['PRODUTO','SERVICO','CONSUMO'] LOOP
      FOREACH v_natureza IN ARRAY ARRAY['RECEITA','DESPESA'] LOOP
        IF v_tipo='CONSUMO' AND v_natureza='RECEITA' THEN CONTINUE; END IF;
        v_evento := public.criar_evento_financeiro_manual_venda(v_venda,v_natureza,v_tipo,'Complemento','Detalhe',31.125,v_usuario);
        v_id := (v_evento->>'id')::bigint;
        IF NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE id=v_id
          AND ordemservicoid IS NULL AND source_type='VENDA' AND source_id=v_venda
          AND origem=v_tipo AND natureza=v_natureza AND status='ATIVO' AND is_manual
          AND chave_origem LIKE 'MANUAL:%' AND pode_gerar_transacao AND valor=31.13
          AND created_by=v_usuario AND competencia_em=v_competencia
          AND natureza_dre=public.natureza_dre_de_evento(v_tipo,v_natureza)) THEN
          RAISE EXCEPTION 'Criação incorreta: % / % / %.',v_status,v_tipo,v_natureza;
        END IF;
        IF NOT EXISTS(SELECT 1 FROM public.eventos_financeiros_fila WHERE id=v_id
          AND documento_id=v_venda AND documento_tipo='VENDA') THEN RAISE EXCEPTION 'Manual ausente na fila.'; END IF;
        PERFORM public.sincronizar_eventos_financeiros_venda(v_venda);
        IF (SELECT status FROM public.eventos_financeiros WHERE id=v_id)<>'ATIVO' THEN
          RAISE EXCEPTION 'Sincronização cancelou manual em %.',v_status;
        END IF;
        PERFORM public.alterar_evento_financeiro_manual_venda(v_venda,v_id,'EDITAR',
          '{"descricao":"Título ajustado","detalhe":"Outro detalhe","valor":42.50}',v_usuario);
        IF NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE id=v_id AND valor=42.50
          AND descricao='Título ajustado' AND detalhe='Outro detalhe' AND created_by=v_usuario
          AND dados_snapshot->>'ajustado_por'=v_usuario::text AND dados_snapshot ? 'ajustado_em') THEN
          RAISE EXCEPTION 'Edição perdeu dados/auditoria em %.',v_status;
        END IF;
        PERFORM public.alterar_evento_financeiro_manual_venda(v_venda,v_id,'EXCLUIR','{}',v_usuario);
        IF EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE id=v_id) THEN RAISE EXCEPTION 'Exclusão falhou.'; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.auditoria_evento WHERE tabela='eventos_financeiros'
          AND registro_id=v_id::text AND operacao='DELETE' AND usuario_id=v_usuario) THEN
          RAISE EXCEPTION 'Exclusão sem auditoria.';
        END IF;
      END LOOP;
    END LOOP;
    IF (SELECT valortotal FROM public.venda WHERE id=v_venda)<>0
      OR EXISTS(SELECT 1 FROM public.vendaproduto WHERE venda_id=v_venda)
      OR EXISTS(SELECT 1 FROM public.transacao WHERE vendaid=v_venda) THEN
      RAISE EXCEPTION 'CRUD manual alterou a venda comercial.';
    END IF;
  END LOOP;

  v_erro:=false;
  BEGIN
    PERFORM public.criar_evento_financeiro_manual_venda(v_venda,'RECEITA','CONSUMO','Inválido',null,10,v_usuario);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Aceitou receita de consumo.'; END IF;

  INSERT INTO public.venda(clienteid,created_by,status,sub_total,valortotal,valor_frete,desconto_valor,datavenda)
    VALUES(v_cliente,v_usuario,'ORCAMENTO',100,100,10,5,v_competencia) RETURNING id INTO v_venda;
  INSERT INTO public.vendaproduto(venda_id,produtoid,quantidade,sub_total,valor_total,custo_unitario_aplicado)
    VALUES(v_venda,v_produto,1,100,100,40) RETURNING id INTO v_item;
  UPDATE public.venda SET status='PAGAMENTO' WHERE id=v_venda;
  v_evento:=public.criar_evento_financeiro_manual_venda(v_venda,'DESPESA','PRODUTO','Custo posterior',null,60,v_usuario);
  v_despesa:=(v_evento->>'id')::bigint;
  v_evento:=public.criar_evento_financeiro_manual_venda(v_venda,'RECEITA','SERVICO','Receita complementar',null,120,v_usuario);
  v_receita:=(v_evento->>'id')::bigint;
  SELECT id INTO STRICT v_automatico FROM public.eventos_financeiros WHERE source_type='VENDA'
    AND source_id=v_venda AND origem='PRODUTO' AND natureza='RECEITA' AND chave_origem=v_produto::text;
  UPDATE public.vendaproduto SET sub_total=200,valor_total=200 WHERE id=v_item;
  PERFORM public.sincronizar_eventos_financeiros_venda(v_venda);
  IF (SELECT valor FROM public.eventos_financeiros WHERE id=v_automatico)<>200 THEN
    RAISE EXCEPTION 'Automático não acompanhou produto.';
  END IF;
  v_erro:=false;
  BEGIN
    PERFORM public.alterar_evento_financeiro_manual_venda(v_venda,v_automatico,'EXCLUIR','{}',v_usuario);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Permitiu exclusão automática.'; END IF;
  UPDATE public.eventos_financeiros SET is_manual=true WHERE id=v_automatico;
  v_erro:=false;
  BEGIN
    PERFORM public.alterar_evento_financeiro_manual_venda(v_venda,v_automatico,'EDITAR','{"valor":10}',v_usuario);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Considerou override automático um manual do operador.'; END IF;
  UPDATE public.eventos_financeiros SET is_manual=false WHERE id=v_automatico;
  DELETE FROM public.vendaproduto WHERE id=v_item;
  IF (SELECT status FROM public.eventos_financeiros WHERE id=v_automatico)<>'CANCELADO'
    OR (SELECT status FROM public.eventos_financeiros WHERE id=v_despesa)<>'ATIVO' THEN
    RAISE EXCEPTION 'Remoção de produto confundiu manual e automático.';
  END IF;
  UPDATE public.venda SET valor_frete=0,desconto_valor=0 WHERE id=v_venda;
  FOREACH v_status IN ARRAY enum_range(NULL::public.enum_status_venda) LOOP
    UPDATE public.venda SET status=v_status,motivo_cancelamento='Regressão de eventos manuais' WHERE id=v_venda;
    PERFORM public.sincronizar_eventos_financeiros_venda(v_venda);
    IF EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE id IN(v_despesa,v_receita) AND status<>'ATIVO') THEN
      RAISE EXCEPTION 'Troca de status % cancelou manual.',v_status;
    END IF;
  END LOOP;
  UPDATE public.venda SET status='CANCELADA',motivo_cancelamento='Regressão' WHERE id=v_venda;
  SELECT valortotal INTO v_total FROM public.venda WHERE id=v_venda;
  SELECT sum(valor) INTO v_antes FROM public.eventos_financeiros WHERE id IN(v_despesa,v_receita);

  -- Grupo de duas parcelas de despesa em venda cancelada, sem novo fato DRE.
  v_grupo:=public.registrar_lancamento_de_eventos(jsonb_build_object('eventos_ids',jsonb_build_array(v_despesa),
    'created_by',v_usuario,'pendente',true,'metodopagamento','PIX','linhas',jsonb_build_array(
      jsonb_build_object('parcela',1,'total_parcelas',2,'valor',30,'vencimento_em',now()),
      jsonb_build_object('parcela',2,'total_parcelas',2,'valor',30,'vencimento_em',now()+interval '1 month'))));
  IF (SELECT count(*) FROM public.transacao WHERE lancamento_id=v_grupo)<>2 THEN RAISE EXCEPTION 'Parcelamento não criou títulos.'; END IF;
  IF EXISTS(SELECT 1 FROM public.eventos_financeiros e JOIN public.transacao t
    ON e.source_type='TRANSACAO' AND e.source_id=t.id WHERE t.lancamento_id=v_grupo AND e.status<>'CANCELADO') THEN
    RAISE EXCEPTION 'Parcelamento duplicou despesa na DRE.';
  END IF;
  v_erro:=false;
  BEGIN
    PERFORM public.alterar_evento_financeiro_manual_venda(v_venda,v_despesa,'EXCLUIR','{}',v_usuario);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Excluiu despesa vinculada.'; END IF;
  v_erro:=false;
  BEGIN
    PERFORM public.alterar_evento_financeiro_manual_venda(v_venda,v_despesa,'EDITAR','{"valor":10}',v_usuario);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Editou despesa vinculada.'; END IF;
  PERFORM public.excluir_lancamento_de_eventos(v_grupo,v_usuario);
  IF NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE id=v_despesa AND status='ATIVO' AND lancamento_id IS NULL) THEN
    RAISE EXCEPTION 'Desfazer grupo não restaurou manual.';
  END IF;

  -- Mesma inserção do TransactionDialog: evento_financeiro_id, sem vendaid comercial.
  INSERT INTO public.transacao(descricao,valor,"valorLiquido",data,tipo,pendente,categoria,nomepagador,cpfcnpjpagador,created_by,evento_financeiro_id)
    VALUES('Receita complementar',120,120,now(),'RECEITA',true,'NAO RELACIONADO','Cliente','',v_usuario,v_receita)
    RETURNING id INTO v_transacao;
  IF NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE id=v_receita AND status='CONVERTIDO' AND transacaoid=v_transacao) THEN
    RAISE EXCEPTION 'Receita não foi convertida.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE source_type='TRANSACAO' AND source_id=v_transacao AND status<>'CANCELADO')
    OR (SELECT sum(valor) FROM public.eventos_financeiros WHERE id IN(v_despesa,v_receita))<>v_antes THEN
    RAISE EXCEPTION 'Conversão duplicou fato na DRE.';
  END IF;
  v_erro:=false;
  BEGIN
    PERFORM public.alterar_evento_financeiro_manual_venda(v_venda,v_receita,'EXCLUIR','{}',v_usuario);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Excluiu receita convertida.'; END IF;
  DELETE FROM public.transacao WHERE id=v_transacao;
  IF NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE id=v_receita AND status='ATIVO' AND transacaoid IS NULL) THEN
    RAISE EXCEPTION 'Excluir transação não restaurou receita.';
  END IF;
  IF (SELECT valortotal FROM public.venda WHERE id=v_venda)<>v_total
    OR (SELECT status FROM public.venda WHERE id=v_venda)<>'CANCELADA' THEN
    RAISE EXCEPTION 'Conversão alterou pagamento/status comercial.';
  END IF;
  PERFORM public.alterar_evento_financeiro_manual_venda(v_venda,v_receita,'EXCLUIR','{}',v_usuario);
  PERFORM public.alterar_evento_financeiro_manual_venda(v_venda,v_despesa,'EXCLUIR','{}',v_usuario);

  FOREACH v_funcao IN ARRAY ARRAY[
    'public.criar_evento_financeiro_manual_venda(bigint,text,text,text,text,numeric,uuid)',
    'public.alterar_evento_financeiro_manual_venda(bigint,bigint,text,jsonb,uuid)'] LOOP
    IF has_function_privilege('anon',v_funcao,'EXECUTE') OR has_function_privilege('authenticated',v_funcao,'EXECUTE')
      OR NOT has_function_privilege('service_role',v_funcao,'EXECUTE') THEN
      RAISE EXCEPTION 'Permissão incorreta na RPC manual %.',v_funcao;
    END IF;
  END LOOP;
  RAISE NOTICE 'CRUD em todos os status/tipos, auditoria, sincronização manual/automática, fila, parcelas, receita, estorno e DRE verificados.';
END;
$test$;
ROLLBACK;
