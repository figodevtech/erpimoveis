-- Executar no banco de demonstração. Fixtures e lançamentos são revertidos.
BEGIN;
DO $test$
DECLARE
  v_criador uuid; v_vendedor uuid; v_cliente integer; v_produto integer;
  v_venda integer; v_evento bigint; v_grupo bigint; v_valor numeric; v_banco bigint;
  v_num integer; v_base numeric; v_pct numeric; v_erro boolean;
BEGIN
  SELECT id INTO v_criador FROM public.usuario WHERE ativo ORDER BY id LIMIT 1;
  SELECT id INTO v_vendedor FROM public.usuario WHERE ativo AND id<>v_criador ORDER BY id LIMIT 1;
  SELECT id INTO v_cliente FROM public.cliente ORDER BY id LIMIT 1;
  SELECT id INTO v_produto FROM public.produto ORDER BY id LIMIT 1;
  IF v_vendedor IS NULL OR v_cliente IS NULL OR v_produto IS NULL THEN
    RAISE EXCEPTION 'O teste requer dois usuários ativos, cliente e produto na demonstração.';
  END IF;
  UPDATE public.usuario SET comissao_venda_percent=3 WHERE id=v_criador;
  UPDATE public.usuario SET comissao_venda_percent=10 WHERE id=v_vendedor;

  INSERT INTO public.venda(clienteid,created_by,vendedor,status,sub_total,valortotal,valor_frete,datavenda)
  VALUES(v_cliente,v_criador,v_vendedor,'ORCAMENTO',1000,1070,50,now()) RETURNING id INTO v_venda;
  INSERT INTO public.vendaproduto(venda_id,produtoid,quantidade,sub_total,valor_total,valor_frete)
  VALUES(v_venda,v_produto,1,1000,1020,20);
  SELECT base,percentual,valor_comissao INTO v_base,v_pct,v_valor FROM public.venda_comissao WHERE vendaid=v_venda;
  IF v_base<>1000 OR v_pct<>10 OR v_valor<>100 THEN
    RAISE EXCEPTION 'Base sem ambos os fretes e taxa do vendedor incorretas: %/%/%',v_base,v_pct,v_valor;
  END IF;
  IF EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE source_type='VENDA' AND source_id=v_venda AND origem='COMISSAO' AND status<>'CANCELADO') THEN
    RAISE EXCEPTION 'Orçamento não pode publicar comissão na DRE.';
  END IF;

  UPDATE public.usuario SET comissao_venda_percent=12 WHERE id=v_vendedor;
  UPDATE public.venda SET status='PAGAMENTO' WHERE id=v_venda;
  SELECT id,valor INTO v_evento,v_valor FROM public.eventos_financeiros WHERE source_type='VENDA' AND source_id=v_venda AND origem='COMISSAO' AND status='ATIVO';
  IF v_evento IS NULL OR v_valor<>120 THEN RAISE EXCEPTION 'Fechamento deve apurar a última taxa: %',v_valor; END IF;

  UPDATE public.usuario SET comissao_venda_percent=30 WHERE id=v_vendedor;
  UPDATE public.venda SET valortotal=970 WHERE id=v_venda;
  SELECT percentual,valor_comissao INTO v_pct,v_valor FROM public.venda_comissao WHERE vendaid=v_venda;
  IF v_pct<>12 OR v_valor<>108 THEN RAISE EXCEPTION 'Taxa congelada ou desconto incorreto: %/%',v_pct,v_valor; END IF;
  PERFORM public.sincronizar_eventos_financeiros_venda(v_venda);
  PERFORM public.sincronizar_eventos_financeiros_venda(v_venda);
  SELECT count(*) INTO v_num FROM public.eventos_financeiros WHERE source_type='VENDA' AND source_id=v_venda AND origem='COMISSAO' AND status<>'CANCELADO';
  IF v_num<>1 THEN RAISE EXCEPTION 'Reconciliação duplicou comissão.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.eventos_financeiros_fila WHERE id=v_evento AND documento_tipo='VENDA' AND documento_id=v_venda AND cliente_id=v_cliente) THEN
    RAISE EXCEPTION 'Comissão deve aparecer na fila com origem e cliente corretos.';
  END IF;

  v_grupo := public.registrar_lancamento_de_eventos(jsonb_build_object(
    'eventos_ids',jsonb_build_array(v_evento),'created_by',v_criador,'pendente',true,
    'metodopagamento','PIX','linhas',jsonb_build_array(
      jsonb_build_object('parcela',1,'total_parcelas',2,'valor',60,'vencimento_em',now()),
      jsonb_build_object('parcela',2,'total_parcelas',2,'valor',48,'vencimento_em',now()+interval '1 month'))));
  SELECT count(*),sum(valor) INTO v_num,v_valor FROM public.transacao WHERE lancamento_id=v_grupo;
  IF v_num<>2 OR v_valor<>108 THEN RAISE EXCEPTION 'Parcelamento não fecha com a comissão.'; END IF;
  IF EXISTS(SELECT 1 FROM public.transacao WHERE lancamento_id=v_grupo AND ordemservicoid IS NOT NULL) THEN
    RAISE EXCEPTION 'Comissão de venda não pode ser vinculada a uma OS.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.eventos_financeiros e JOIN public.transacao t ON e.source_type='TRANSACAO' AND e.source_id=t.id WHERE t.lancamento_id=v_grupo AND e.status<>'CANCELADO') THEN
    RAISE EXCEPTION 'O pagamento duplicou o custo na DRE.';
  END IF;

  v_erro:=false;
  BEGIN
    UPDATE public.venda SET valortotal=1000 WHERE id=v_venda;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Comissão comprometida foi alterada.'; END IF;
  v_erro:=false;
  BEGIN
    UPDATE public.venda SET status='CANCELADA',motivo_cancelamento='Cancelamento do teste de comiss?o' WHERE id=v_venda;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Venda com comissão comprometida foi cancelada.'; END IF;
  v_erro:=false;
  BEGIN
    DELETE FROM public.venda WHERE id=v_venda;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Venda com comissão comprometida foi excluída.'; END IF;
  v_erro:=false;
  BEGIN
    PERFORM public.registrar_lancamento_de_eventos(jsonb_build_object('eventos_ids',jsonb_build_array(v_evento),
      'linhas',jsonb_build_array(jsonb_build_object('parcela',1,'valor',108))));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Comissão foi lançada duas vezes.'; END IF;

  SELECT id INTO v_banco FROM public.bancoconta ORDER BY id LIMIT 1;
  IF v_banco IS NULL THEN RAISE EXCEPTION 'O teste requer uma conta bancária na demonstração.'; END IF;
  UPDATE public.transacao SET pendente=false,banco_id=v_banco,pago_em=now()
   WHERE id=(SELECT min(id) FROM public.transacao WHERE lancamento_id=v_grupo);
  v_erro:=false;
  BEGIN
    PERFORM public.excluir_lancamento_de_eventos(v_grupo,v_criador);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Lançamento com parcela paga foi excluído.'; END IF;
  UPDATE public.transacao SET pendente=true,banco_id=null,pago_em=null WHERE lancamento_id=v_grupo;

  PERFORM public.excluir_lancamento_de_eventos(v_grupo,v_criador);
  IF NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE id=v_evento AND status='ATIVO' AND lancamento_id IS NULL) THEN
    RAISE EXCEPTION 'Desfazer lançamento não liberou a comissão.';
  END IF;
  UPDATE public.venda SET status='CANCELADA',motivo_cancelamento='Cancelamento do teste de comiss?o' WHERE id=v_venda;
  IF EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE id=v_evento AND status<>'CANCELADO') THEN
    RAISE EXCEPTION 'Cancelamento não estornou a comissão.';
  END IF;

  IF EXISTS(SELECT 1 FROM public.venda_comissao c JOIN public.eventos_financeiros e
    ON e.source_type='VENDA' AND e.source_id=c.vendaid AND e.origem='COMISSAO'
    WHERE NOT c.integrada AND e.status<>'CANCELADO') THEN
    RAISE EXCEPTION 'O histórico anterior ao mês recebeu despesas novas.';
  END IF;
  RAISE NOTICE 'Comissão: beneficiário, frete, desconto, congelamento, DRE, fila, parcelas, idempotência e estorno verificados.';
END;
$test$;
ROLLBACK;
