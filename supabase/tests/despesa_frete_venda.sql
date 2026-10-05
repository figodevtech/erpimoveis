BEGIN;
DO $test$
DECLARE
  v_usuario uuid; v_cliente integer; v_venda integer; v_outra integer;
  v_receita bigint; v_despesa bigint; v_lancamento bigint; v_evento jsonb;
  v_erro boolean; v_total numeric;
BEGIN
  SELECT id INTO v_usuario FROM public.usuario WHERE ativo ORDER BY id LIMIT 1;
  SELECT id INTO v_cliente FROM public.cliente ORDER BY id LIMIT 1;
  IF v_usuario IS NULL OR v_cliente IS NULL THEN RAISE EXCEPTION 'Teste requer usuário e cliente.'; END IF;
  INSERT INTO public.venda(clienteid,created_by,status,sub_total,valortotal,valor_frete,datavenda)
    VALUES(v_cliente,v_usuario,'ORCAMENTO',0,100,100,now()) RETURNING id INTO v_venda;
  UPDATE public.venda SET status='PAGAMENTO' WHERE id=v_venda;
  INSERT INTO public.venda(clienteid,created_by,status,sub_total,valortotal,valor_frete,datavenda)
    VALUES(v_cliente,v_usuario,'ORCAMENTO',0,100,100,now()) RETURNING id INTO v_outra;
  UPDATE public.venda SET status='PAGAMENTO' WHERE id=v_outra;
  SELECT id INTO STRICT v_receita FROM public.eventos_financeiros
    WHERE source_type='VENDA' AND source_id=v_venda AND origem='FRETE' AND natureza='RECEITA' AND status='ATIVO';

  v_erro:=false;
  BEGIN
    PERFORM public.criar_despesa_frete_venda(v_outra,v_receita,'Frete',null,65,v_usuario);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Aceitou receita de outra venda.'; END IF;
  v_erro:=false;
  BEGIN
    PERFORM public.criar_despesa_frete_venda(v_venda,v_receita,'Frete',null,0.001,v_usuario);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Aceitou despesa arredondada para zero.'; END IF;

  v_evento:=public.criar_despesa_frete_venda(v_venda,v_receita,'Transportadora','Entrega',65.125,v_usuario);
  v_despesa:=(v_evento->>'id')::bigint;
  IF NOT EXISTS(SELECT 1 FROM public.eventos_financeiros e JOIN public.eventos_financeiros r ON r.id=v_receita
    WHERE e.id=v_despesa AND e.source_id=v_venda AND e.source_type='VENDA' AND e.ordemservicoid IS NULL
      AND e.source_item_id=v_receita AND e.origem='FRETE' AND e.natureza='DESPESA' AND e.valor=65.13
      AND e.is_manual AND e.pode_gerar_transacao AND e.created_by=v_usuario
      AND e.competencia_em=r.competencia_em AND e.dados_snapshot->>'dre_linha_codigo'='4.6') THEN
    RAISE EXCEPTION 'Despesa perdeu valor, proveniência ou competência.';
  END IF;
  SELECT valortotal INTO v_total FROM public.venda WHERE id=v_venda;
  IF v_total<>100 OR (SELECT valor FROM public.eventos_financeiros WHERE id=v_receita)<>100 THEN
    RAISE EXCEPTION 'Criar despesa alterou o valor cobrado.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.eventos_financeiros_fila WHERE id=v_despesa
    AND documento_tipo='VENDA' AND documento_id=v_venda AND cliente_id=v_cliente) THEN
    RAISE EXCEPTION 'Despesa não apareceu na fila financeira.';
  END IF;

  -- Receita pode ser zerada sem apagar o custo já contratado.
  UPDATE public.venda SET valor_frete=0,valortotal=0 WHERE id=v_venda;
  PERFORM public.sincronizar_eventos_financeiros_venda(v_venda);
  IF (SELECT status FROM public.eventos_financeiros WHERE id=v_despesa)<>'ATIVO' THEN
    RAISE EXCEPTION 'Zerar frete apagou a despesa manual.';
  END IF;
  v_erro:=false;
  BEGIN
    PERFORM public.criar_despesa_frete_venda(v_venda,v_receita,'Outro frete',null,10,v_usuario);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Aceitou receita cancelada.'; END IF;

  v_lancamento:=public.registrar_lancamento_de_eventos(jsonb_build_object(
    'eventos_ids',jsonb_build_array(v_despesa),'created_by',v_usuario,'pendente',true,
    'metodopagamento','PIX','linhas',jsonb_build_array(
      jsonb_build_object('parcela',1,'total_parcelas',1,'valor',65.13,'vencimento_em',now()))));
  IF NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE id=v_despesa AND status='CONVERTIDO'
    AND lancamento_id=v_lancamento) THEN RAISE EXCEPTION 'Despesa não foi lançada.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.transacao WHERE lancamento_id=v_lancamento
    AND valor=65.13 AND ordemservicoid IS NULL) THEN RAISE EXCEPTION 'Título financeiro incorreto.'; END IF;
  IF EXISTS(SELECT 1 FROM public.eventos_financeiros e JOIN public.transacao t
    ON e.source_type='TRANSACAO' AND e.source_id=t.id WHERE t.lancamento_id=v_lancamento AND e.status<>'CANCELADO') THEN
    RAISE EXCEPTION 'Pagamento duplicou a despesa na DRE.';
  END IF;
  v_erro:=false;
  BEGIN
    PERFORM public.registrar_lancamento_de_eventos(jsonb_build_object('eventos_ids',jsonb_build_array(v_despesa),
      'linhas',jsonb_build_array(jsonb_build_object('parcela',1,'valor',65.13))));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Lançamento duplicado foi aceito.'; END IF;
  PERFORM public.excluir_lancamento_de_eventos(v_lancamento,v_usuario);
  IF NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE id=v_despesa AND status='ATIVO'
    AND lancamento_id IS NULL) THEN RAISE EXCEPTION 'Desfazer lançamento não liberou despesa.'; END IF;

  UPDATE public.venda SET status='CANCELADA',motivo_cancelamento='Teste de despesa de frete' WHERE id=v_venda;
  IF (SELECT status FROM public.eventos_financeiros WHERE id=v_despesa)<>'ATIVO' THEN
    RAISE EXCEPTION 'Cancelamento da venda cancelou despesa manual.';
  END IF;
  RAISE NOTICE 'Frete de venda: vínculo, valor, competência, fila, sincronização, lançamento, duplicidade e estorno verificados.';
END;
$test$;
ROLLBACK;
