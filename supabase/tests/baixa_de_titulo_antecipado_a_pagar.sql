-- O mesmo caso, do lado de a pagar.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/baixa_de_titulo_antecipado_a_pagar.sql
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito.
--
-- O CASO ESPELHADO
-- Antecipação não é só de recebimento. Do lado de a pagar ela é o pagamento
-- único que cobre vários títulos — um borderô mandado ao banco, ou a quitação
-- adiantada de um fornecedor. O dinheiro sai uma vez, e os títulos podem ficar
-- em aberto para acompanhar a confirmação de cada um.
--
--   1. três títulos a pagar de R$ 1.000; pagamento antecipado de R$ 3.000,
--      mantendo os títulos em aberto;
--   2. um dos pagamentos volta — conta errada, boleto vencido, fornecedor
--      recusou — e o banco CREDITA os R$ 1.000 de volta;
--   3. o usuário registra esse crédito como receita;
--   4. quando paga aquele fornecedor de fato, dá a baixa COM lançamento, e os
--      R$ 1.000 saem da conta agora.
--
-- É a mesma mecânica do a receber com os sinais trocados: lá o banco debita uma
-- entrada que não se confirmou, aqui ele credita de volta uma saída que não se
-- confirmou.

BEGIN;

CREATE TEMP TABLE _criadas (id bigint PRIMARY KEY) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.saldo_do_teste(p_banco bigint)
RETURNS numeric LANGUAGE sql AS $$
  SELECT round(coalesce(sum(
    CASE WHEN upper(t.tipo::text) IN ('RECEITA','DEPOSITO')
         THEN coalesce(nullif(t."valorLiquido", 0), t.valor)
         ELSE -coalesce(nullif(t."valorLiquido", 0), t.valor) END
  ), 0), 2)
  FROM public.transacao t
  JOIN _criadas c ON c.id = t.id
  WHERE t.is_deleted = false
    AND t.pendente = false
    AND t.banco_id = p_banco;
$$;

DO $t$
DECLARE
  v_banco bigint;
  v_ids bigint[] := ARRAY[]::bigint[];
  v_p1 bigint; v_p2 bigint; v_p3 bigint;
  v_adi bigint;
  v_adi_foto jsonb;
  v_resultado jsonb;
  v_tx public.transacao%ROWTYPE;
  v_saldo numeric(14,2);
  v_n int;
  v_novo bigint;
  v_ok int := 0;
  v_falhou int := 0;
BEGIN
  IF to_regprocedure('public.baixar_transacao_pendente(bigint,timestamptz,bigint,text,integer,integer,uuid,boolean,numeric)') IS NULL THEN
    RAISE EXCEPTION 'baixar_transacao_pendente ainda nao aceita p_lancar_no_caixa/p_valor. Rode as migrations.';
  END IF;

  SELECT id INTO v_banco FROM public.bancoconta ORDER BY id LIMIT 1;
  IF v_banco IS NULL THEN RAISE EXCEPTION 'Nenhum banco cadastrado.'; END IF;

  /* ---------------- fixture: tres titulos A PAGAR ---------------- */

  CREATE TEMP TABLE _molde ON COMMIT DROP AS
    SELECT * FROM public.transacao WHERE is_deleted = false LIMIT 1;

  FOR v_n IN 1..3 LOOP
    UPDATE _molde SET
      id = nextval(pg_get_serial_sequence('public.transacao','id')),
      ordemservicoid = NULL, vendaid = NULL, entrada_id = NULL, usoconsumo_entrada_id = NULL,
      evento_financeiro_id = NULL, estorno_transacao_id = NULL, pagamento_multiplo_id = NULL,
      adiantamento_id = NULL, eh_adiantamento = false, adiantamento_manteve_pendentes = NULL,
      parcelamento_id = NULL, is_deleted = false, pendente = true,
      tipo = 'DESPESA'::public.tipos_transacao,
      valor = 1000.00, valor_base = 1000.00, "valorLiquido" = 1000.00,
      valor_acrescimos = 0, valor_descontos = 0,
      banco_id = NULL, pago_em = NULL, baixado_por = NULL,
      vencimento_em = date_trunc('day', now() + (v_n || ' days')::interval),
      data = date_trunc('day', now() + (v_n || ' days')::interval),
      descricao = 'TESTE A PAGAR ANTECIPADO ' || v_n;
    INSERT INTO public.transacao SELECT * FROM _molde;
    SELECT id INTO v_novo FROM _molde;
    INSERT INTO _criadas VALUES (v_novo);
    v_ids := v_ids || v_novo;
  END LOOP;

  v_p1 := v_ids[1]; v_p2 := v_ids[2]; v_p3 := v_ids[3];

  /* ---------------- 1. pagamento antecipado, titulos em aberto ----------- */

  v_resultado := public.baixar_por_adiantamento(
    ARRAY[v_p1, v_p2, v_p3],
    jsonb_build_object(
      'banco_id', v_banco, 'metodopagamento', 'PIX', 'pago_em', now()::text, 'taxa', 0,
      'descricao', 'TESTE PAGAMENTO ANTECIPADO DE 3 TITULOS',
      'categoria_id', (SELECT categoria_id FROM _molde),
      'manter_titulos_pendentes', true
    ),
    NULL
  );
  v_adi := (v_resultado->>'adiantamento_id')::bigint;
  INSERT INTO _criadas VALUES (v_adi);
  SELECT to_jsonb(t) INTO v_adi_foto FROM public.transacao t WHERE t.id = v_adi;

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_adi;
  v_saldo := pg_temp.saldo_do_teste(v_banco);

  IF upper(v_tx.tipo::text) = 'DESPESA' AND v_saldo = -3000.00
     AND v_tx.adiantamento_manteve_pendentes IS TRUE THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: sairam R$ 3.000,00 da conta num pagamento so, tipo DESPESA';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: tipo=%, conta=%', v_tx.tipo, v_saldo;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.transacao
   WHERE id = ANY(ARRAY[v_p1, v_p2, v_p3])
     AND pendente = true AND adiantamento_id = v_adi AND banco_id IS NULL;
  IF v_n = 3 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: os 3 titulos a pagar seguem em aberto, marcados como antecipados';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 2: % titulo(s) no estado esperado', v_n;
  END IF;

  /* ---------------- 2. um pagamento e devolvido pelo banco --------------- */
  -- Espelho exato do a receber: la o banco debita uma entrada que nao se
  -- confirmou; aqui credita de volta uma saida que nao se confirmou.

  PERFORM public.baixar_transacao_pendente(
    v_p1, now(), v_banco, 'PIX', NULL, NULL, NULL, false
  );

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    tipo = 'RECEITA'::public.tipos_transacao,
    valor = 1000.00, valor_base = 1000.00, "valorLiquido" = 1000.00,
    pendente = false, banco_id = v_banco, pago_em = now(), data = now(), vencimento_em = now(),
    descricao = 'TESTE DEVOLUCAO DE PAGAMENTO PELO BANCO';
  INSERT INTO public.transacao SELECT * FROM _molde;
  SELECT id INTO v_novo FROM _molde;
  INSERT INTO _criadas VALUES (v_novo);

  v_saldo := pg_temp.saldo_do_teste(v_banco);
  IF v_saldo = -2000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: o credito de volta levou a conta de -3.000 para -2.000';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: conta em % em vez de -2000.00', v_saldo;
  END IF;

  /* ---------------- 3. paga o fornecedor de fato: COM lancamento --------- */

  v_resultado := public.baixar_transacao_pendente(
    v_p2, now(), v_banco, 'PIX', NULL, NULL, NULL, true
  );

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_p2;
  v_saldo := pg_temp.saldo_do_teste(v_banco);

  IF v_tx.banco_id = v_banco AND (v_resultado->>'lancado_no_caixa')::boolean IS TRUE
     AND v_saldo = -3000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: a saida real levou a conta de volta a -3.000,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: banco=%, conta=%', v_tx.banco_id, v_saldo;
  END IF;

  /* ---------------- 4. as mesmas recusas valem aqui ---------------------- */

  BEGIN
    PERFORM public.desfazer_adiantamento(v_adi, NULL);
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 5: desfez o pagamento antecipado apagando uma saida real';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm ILIKE '%baixado com lancamento%' OR sqlerrm ILIKE '%baixado com lançamento%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 5: recusou desfazer o pagamento antecipado, como no a receber';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 5: recusou com outra mensagem: %', sqlerrm;
    END IF;
  END;

  BEGIN
    UPDATE public.transacao SET banco_id = v_banco WHERE id = v_p3;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 6: deixou dar banco a um a pagar antecipado em aberto';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm ILIKE '%duas vezes%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 6: a trava do banco vale igual no a pagar';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 6: barrou com outra mensagem: %', sqlerrm;
    END IF;
  END;

  /* ---------------- 5. estorno e invariante ------------------------------ */

  PERFORM public.estornar_baixa_transacao(v_p2, NULL);
  SELECT * INTO v_tx FROM public.transacao WHERE id = v_p2;
  v_saldo := pg_temp.saldo_do_teste(v_banco);

  IF v_tx.pendente = true AND v_tx.banco_id IS NULL AND v_saldo = -2000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 7: o estorno devolveu o titulo a pagar e a conta a -2.000,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 7: pendente=%, banco=%, conta=%', v_tx.pendente, v_tx.banco_id, v_saldo;
  END IF;

  IF (SELECT to_jsonb(t) FROM public.transacao t WHERE t.id = v_adi) = v_adi_foto THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 8: o pagamento antecipado de R$ 3.000,00 seguiu intacto';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 8: o pagamento antecipado mudou';
  END IF;

  RAISE NOTICE '---';
  RAISE NOTICE '=== % passaram, % falharam ===', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Ha % verificacoes falhando.', v_falhou;
  END IF;
END $t$;

ROLLBACK;
