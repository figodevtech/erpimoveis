-- Regressão do fluxo financeiro antecipado da OS. Tudo termina em ROLLBACK.
BEGIN;

DO $$
DECLARE
  v_os integer;
  v_pago bigint;
  v_boleto bigint;
  v_resumo record;
  v_status text;
BEGIN
  IF to_regprocedure('public.resumo_financeiro_os(integer)') IS NULL THEN
    RAISE EXCEPTION 'A função resumo_financeiro_os não existe.';
  END IF;

  SELECT o.id INTO v_os
  FROM public.ordemservico o
  WHERE coalesce(o.is_deleted, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.transacao t
      WHERE t.ordemservicoid = o.id AND t.is_deleted = false
    )
  LIMIT 1;

  IF v_os IS NULL THEN
    RAISE EXCEPTION 'Nenhuma OS sem transações disponível para o teste.';
  END IF;

  UPDATE public.ordemservico
  SET status = 'ORCAMENTO_APROVADO',
      orcamentototal = 1000,
      acrescimo_financeiro_tipo = NULL,
      acrescimo_financeiro_valor = 0,
      pagamento_concluido_em = NULL
  WHERE id = v_os;

  CREATE TEMP TABLE _tx_os ON COMMIT DROP AS
  SELECT * FROM public.transacao
  WHERE is_deleted = false AND upper(tipo::text) = 'RECEITA'
  LIMIT 1;

  IF (SELECT count(*) FROM _tx_os) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma receita disponível como molde.';
  END IF;

  UPDATE _tx_os SET
    id = nextval(pg_get_serial_sequence('public.transacao', 'id')),
    ordemservicoid = v_os,
    vendaid = NULL,
    entrada_id = NULL,
    usoconsumo_entrada_id = NULL,
    evento_financeiro_id = NULL,
    adiantamento_id = NULL,
    eh_adiantamento = false,
    estorno_transacao_id = NULL,
    is_deleted = false,
    pendente = false,
    valor = 400,
    valor_base = 400,
    valor_acrescimos = 0,
    valor_descontos = 0,
    "valorLiquido" = 400,
    descricao = 'TESTE OS - recebido',
    data = now();
  INSERT INTO public.transacao SELECT * FROM _tx_os RETURNING id INTO v_pago;

  UPDATE _tx_os SET
    id = nextval(pg_get_serial_sequence('public.transacao', 'id')),
    pendente = true,
    valor = 600,
    valor_base = 600,
    "valorLiquido" = 600,
    descricao = 'TESTE OS - boletos';
  INSERT INTO public.transacao SELECT * FROM _tx_os RETURNING id INTO v_boleto;

  SELECT * INTO v_resumo FROM public.resumo_financeiro_os(v_os);
  IF v_resumo.valor_recebido <> 400
     OR v_resumo.valor_pendente <> 600
     OR v_resumo.valor_comprometido <> 1000
     OR v_resumo.quitada IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Resumo incorreto: %', row_to_json(v_resumo);
  END IF;

  SELECT status::text INTO v_status FROM public.ordemservico WHERE id = v_os;
  IF v_status <> 'ORCAMENTO_APROVADO' THEN
    RAISE EXCEPTION 'Pagamento antecipado encerrou a execução: status %.', v_status;
  END IF;
  RAISE NOTICE 'OK: pagamento + boletos quitam sem encerrar a execução.';

  UPDATE public.ordemservico SET status = 'PAGAMENTO' WHERE id = v_os;
  PERFORM public.recalcular_status_financeiro_os(v_os);
  SELECT status::text INTO v_status FROM public.ordemservico WHERE id = v_os;
  IF v_status <> 'CONCLUIDO' THEN
    RAISE EXCEPTION 'OS quitada não foi concluída: status %.', v_status;
  END IF;
  RAISE NOTICE 'OK: fim da execução conclui OS coberta por títulos.';

  DELETE FROM public.transacao WHERE id = v_boleto;
  SELECT status::text INTO v_status FROM public.ordemservico WHERE id = v_os;
  IF v_status <> 'PAGAMENTO' THEN
    RAISE EXCEPTION 'Exclusão não reabriu a cobrança: status %.', v_status;
  END IF;
  RAISE NOTICE 'OK: exclusão direta recalcula e reabre o pagamento.';

  BEGIN
    UPDATE _tx_os SET
      id = nextval(pg_get_serial_sequence('public.transacao', 'id')),
      pendente = true,
      valor = 601,
      valor_base = 601,
      "valorLiquido" = 601,
      descricao = 'TESTE OS - excedente';
    INSERT INTO public.transacao SELECT * FROM _tx_os;
    RAISE EXCEPTION 'O limite financeiro aceitou valor excedente.';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: banco recusou valor acima do saldo.';
  END;
END $$;

ROLLBACK;
