-- Título antecipado que voltou pelo banco e foi pago com juros.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/baixa_de_titulo_antecipado_com_juros.sql
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito.
--
-- O CASO
-- É o de `baixa_de_titulo_antecipado.sql` com uma volta a mais. O boleto não foi
-- pago, o banco debitou o valor de volta, e quando o cliente veio pagar já havia
-- atraso: o título ganha juros antes da baixa.
--
--   1. quatro parcelas de R$ 1.000; três antecipadas, mantidas em aberto;
--   2. a segunda não é paga e o banco debita R$ 1.000 da conta;
--   3. o cliente aparece atrasado — lança-se R$ 50 de juros no título;
--   4. a baixa é feita COM lançamento, e entram R$ 1.050 na conta.
--
-- OS DOIS INVARIANTES
-- O juros é dinheiro que nasceu do atraso, não do que o banco adiantou: ele
-- entra por este título e por mais nada. E a antecipação de R$ 3.000 continua
-- intocada — ela financiou o principal, e o atraso não é assunto dela.

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
  v_tipo_juros integer;
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

  SELECT id INTO v_tipo_juros
    FROM public.tipos_ajuste_transacao
   WHERE natureza = 'ACRESCIMO' AND ativo IS TRUE
   ORDER BY id LIMIT 1;
  IF v_tipo_juros IS NULL THEN
    RAISE EXCEPTION 'Nenhum tipo de acrescimo cadastrado para servir de juros.';
  END IF;

  /* ---------------- fixture ---------------- */

  CREATE TEMP TABLE _molde ON COMMIT DROP AS
    SELECT * FROM public.transacao WHERE is_deleted = false LIMIT 1;

  FOR v_n IN 1..3 LOOP
    UPDATE _molde SET
      id = nextval(pg_get_serial_sequence('public.transacao','id')),
      ordemservicoid = NULL, vendaid = NULL, entrada_id = NULL, usoconsumo_entrada_id = NULL,
      evento_financeiro_id = NULL, estorno_transacao_id = NULL, pagamento_multiplo_id = NULL,
      adiantamento_id = NULL, eh_adiantamento = false, adiantamento_manteve_pendentes = NULL,
      parcelamento_id = NULL, is_deleted = false, pendente = true,
      tipo = 'RECEITA'::public.tipos_transacao,
      valor = 1000.00, valor_base = 1000.00, "valorLiquido" = 1000.00,
      valor_acrescimos = 0, valor_descontos = 0,
      banco_id = NULL, pago_em = NULL, baixado_por = NULL,
      vencimento_em = date_trunc('day', now() - interval '15 days'),
      data = date_trunc('day', now() - interval '15 days'),
      descricao = 'TESTE JUROS PARCELA ' || v_n;
    INSERT INTO public.transacao SELECT * FROM _molde;
    SELECT id INTO v_novo FROM _molde;
    INSERT INTO _criadas VALUES (v_novo);
    v_ids := v_ids || v_novo;
  END LOOP;

  v_p1 := v_ids[1]; v_p2 := v_ids[2]; v_p3 := v_ids[3];

  /* ---------------- 1. antecipar mantendo em aberto ---------------- */

  v_resultado := public.baixar_por_adiantamento(
    ARRAY[v_p1, v_p2, v_p3],
    jsonb_build_object(
      'banco_id', v_banco, 'metodopagamento', 'PIX', 'pago_em', now()::text, 'taxa', 0,
      'descricao', 'TESTE ANTECIPACAO COM JUROS DEPOIS',
      'categoria_id', (SELECT categoria_id FROM _molde),
      'manter_titulos_pendentes', true
    ),
    NULL
  );
  v_adi := (v_resultado->>'adiantamento_id')::bigint;
  INSERT INTO _criadas VALUES (v_adi);
  SELECT to_jsonb(t) INTO v_adi_foto FROM public.transacao t WHERE t.id = v_adi;

  IF pg_temp.saldo_do_teste(v_banco) = 3000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: antecipacao trouxe R$ 3.000,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: conta em %', pg_temp.saldo_do_teste(v_banco);
  END IF;

  /* ---------------- 2. o banco debita a parcela nao paga ---------------- */

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    tipo = 'DESPESA'::public.tipos_transacao,
    valor = 1000.00, valor_base = 1000.00, "valorLiquido" = 1000.00,
    pendente = false, banco_id = v_banco, pago_em = now(), data = now(), vencimento_em = now(),
    descricao = 'TESTE DEVOLUCAO DE BOLETO PELO BANCO';
  INSERT INTO public.transacao SELECT * FROM _molde;
  SELECT id INTO v_novo FROM _molde;
  INSERT INTO _criadas VALUES (v_novo);

  IF pg_temp.saldo_do_teste(v_banco) = 2000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: o debito do banco levou a conta a R$ 2.000,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 2: conta em %', pg_temp.saldo_do_teste(v_banco);
  END IF;

  /* ---------------- 3. o juros do atraso, antes da baixa ---------------- */
  -- O titulo esta antecipado E em aberto. Lancar acrescimo aqui precisa
  -- funcionar como em qualquer outro titulo: e uma divida que cresceu.

  INSERT INTO public.transacao_ajuste (
    transacao_id, tipo_id, natureza, modo, valor_informado, valor_calculado, created_by
  ) VALUES (
    v_p2, v_tipo_juros, 'ACRESCIMO', 'FIXO', 50.00, 50.00, NULL
  );

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_p2;

  IF v_tx.valor = 1050.00 AND v_tx.valor_base = 1000.00
     AND v_tx.valor_acrescimos = 50.00 AND v_tx."valorLiquido" = 1050.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: o juros subiu o titulo para R$ 1.050,00, com face de R$ 1.000,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: valor=%, base=%, acrescimos=%, liquido=%',
      v_tx.valor, v_tx.valor_base, v_tx.valor_acrescimos, v_tx."valorLiquido";
  END IF;

  -- O titulo ainda esta em aberto: nada entrou na conta por causa do juros.
  IF pg_temp.saldo_do_teste(v_banco) = 2000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: lancar o juros nao moveu a conta sozinho';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: conta em % depois so de lancar juros', pg_temp.saldo_do_teste(v_banco);
  END IF;

  -- E o titulo segue sem banco, como todo antecipado em aberto.
  IF v_tx.banco_id IS NULL AND v_tx.pendente = true AND v_tx.adiantamento_id = v_adi THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 5: o titulo continua antecipado e em aberto';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 5: banco=%, pendente=%', v_tx.banco_id, v_tx.pendente;
  END IF;

  /* ---------------- 4. a baixa COM lancamento, ja com o juros ------------ */

  v_resultado := public.baixar_transacao_pendente(
    v_p2, now(), v_banco, 'BOLETO', NULL, NULL, NULL, true
  );

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_p2;
  v_saldo := pg_temp.saldo_do_teste(v_banco);

  IF v_tx.banco_id = v_banco AND v_tx.valor = 1050.00 AND v_saldo = 3050.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 6: entraram R$ 1.050,00 e a conta foi a R$ 3.050,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 6: banco=%, valor=%, conta=%', v_tx.banco_id, v_tx.valor, v_saldo;
  END IF;

  -- Os R$ 50 acima dos R$ 3.000 antecipados sao exatamente o juros: o atraso
  -- rendeu dinheiro que a antecipacao nao havia trazido.
  IF v_saldo - 3000.00 = 50.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 7: a sobra sobre o antecipado e o juros, nem um centavo a mais';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 7: sobra de % em vez de 50.00', v_saldo - 3000.00;
  END IF;

  /* ---------------- 5. a antecipacao nao soube de nada ------------------- */

  IF (SELECT to_jsonb(t) FROM public.transacao t WHERE t.id = v_adi) = v_adi_foto THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 8: a antecipacao de R$ 3.000,00 seguiu intacta apesar do juros';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 8: a antecipacao mudou: %',
      (SELECT to_jsonb(t) FROM public.transacao t WHERE t.id = v_adi);
  END IF;

  /* ---------------- 6. depois da baixa o valor trava ---------------------- */
  -- Regra antiga da casa (20260806120000): titulo liquidado nao muda de valor.
  -- Vale aqui tambem, e e o que obriga a lancar o juros ANTES da baixa.

  BEGIN
    INSERT INTO public.transacao_ajuste (
      transacao_id, tipo_id, natureza, modo, valor_informado, valor_calculado, created_by
    ) VALUES (v_p2, v_tipo_juros, 'ACRESCIMO', 'FIXO', 10.00, 10.00, NULL);
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 9: aceitou juros novo depois da baixa';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 9: recusou mexer no valor depois da baixa';
  END;

  /* ---------------- 7. o estorno devolve o titulo sem o juros ------------ */
  -- O acrescimo nasceu do atraso ate aquela data, e a data deixou de existir.

  PERFORM public.estornar_baixa_transacao(v_p2, NULL);
  SELECT * INTO v_tx FROM public.transacao WHERE id = v_p2;
  v_saldo := pg_temp.saldo_do_teste(v_banco);

  IF v_tx.pendente = true AND v_tx.valor = 1000.00 AND v_tx.valor_acrescimos = 0
     AND v_tx.banco_id IS NULL AND v_tx.adiantamento_id = v_adi AND v_saldo = 2000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 10: estornou, tirou o juros e voltou a R$ 1.000,00 em aberto';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 10: pendente=%, valor=%, acrescimos=%, banco=%, conta=%',
      v_tx.pendente, v_tx.valor, v_tx.valor_acrescimos, v_tx.banco_id, v_saldo;
  END IF;

  IF (SELECT to_jsonb(t) FROM public.transacao t WHERE t.id = v_adi) = v_adi_foto THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 11: a antecipacao seguiu intacta tambem depois do estorno';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 11: a antecipacao mudou no estorno';
  END IF;

  RAISE NOTICE '---';
  RAISE NOTICE '=== % passaram, % falharam ===', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Ha % verificacoes falhando.', v_falhou;
  END IF;
END $t$;

ROLLBACK;
