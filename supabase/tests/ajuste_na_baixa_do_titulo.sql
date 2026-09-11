-- Acréscimo e desconto lançados no ato da baixa (20260910180000).
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/ajuste_na_baixa_do_titulo.sql
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito.

BEGIN;

DO $$
DECLARE
  v_col_gerada text;
  v_cols       text;
  v_banco      bigint;
  v_tipo_juros integer;
  v_tipo_desc  integer;
  v_tx         bigint;
  v_valor      numeric;
  v_base       numeric;
  v_acres      numeric;
  v_desc       numeric;
  v_pendente   boolean;
  v_banco_tx   bigint;
  v_qtd        int;
  v_ok         int := 0;
  v_falhou     int := 0;
BEGIN
  /* ---------------- pré-requisitos ---------------- */

  IF to_regprocedure('public.baixar_transacao_pendente(bigint,timestamptz,bigint,text,integer,integer,uuid,numeric,numeric,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'baixar_transacao_pendente ainda nao aceita p_ajustes. Rode as migrations.';
  END IF;

  -- A assinatura de nove argumentos tem que ter SUMIDO: com as duas no banco,
  -- toda chamada por nome vira 42702 "function is not unique".
  IF to_regprocedure('public.baixar_transacao_pendente(bigint,timestamptz,bigint,text,integer,integer,uuid,numeric,numeric)') IS NOT NULL THEN
    RAISE EXCEPTION 'A assinatura antiga de 9 argumentos continua no banco: as chamadas por nome ficam ambiguas.';
  END IF;

  SELECT id INTO v_banco FROM public.bancoconta ORDER BY id LIMIT 1;
  IF v_banco IS NULL THEN
    RAISE EXCEPTION 'Nenhuma conta bancária para servir de fixture.';
  END IF;

  SELECT id INTO v_tipo_juros FROM public.tipos_ajuste_transacao WHERE codigo = 'JUROS';
  SELECT id INTO v_tipo_desc FROM public.tipos_ajuste_transacao WHERE codigo = 'DESCONTO_COMERCIAL';
  IF v_tipo_juros IS NULL OR v_tipo_desc IS NULL THEN
    RAISE EXCEPTION 'Catálogo de tipos de ajuste incompleto.';
  END IF;

  /* ---------------- molde ---------------- */

  CREATE TEMP TABLE _molde ON COMMIT DROP AS
    SELECT * FROM public.transacao
     WHERE is_deleted = false AND upper(tipo::text) = 'RECEITA'
     LIMIT 1;

  FOR v_col_gerada IN
    SELECT a.attname FROM pg_attribute a
     WHERE a.attrelid = '_molde'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname IN (
         SELECT b.attname FROM pg_attribute b
          WHERE b.attrelid = 'public.transacao'::regclass AND b.attgenerated <> ''
       )
  LOOP
    EXECUTE format('ALTER TABLE _molde DROP COLUMN %I', v_col_gerada);
  END LOOP;

  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = '_molde'::regclass AND a.attnum > 0 AND NOT a.attisdropped;

  UPDATE _molde SET
    ordemservicoid = NULL, vendaid = NULL, entrada_id = NULL, usoconsumo_entrada_id = NULL,
    evento_financeiro_id = NULL, estorno_transacao_id = NULL, pagamento_multiplo_id = NULL,
    adiantamento_id = NULL, eh_adiantamento = false, transferencia_id = NULL,
    parcelamento_id = NULL, baixa_de_transacao_id = NULL, lancamento_id = NULL,
    valor_acrescimos = 0, valor_descontos = 0, valor_baixado = 0,
    is_deleted = false, pendente = true, banco_id = NULL, pago_em = NULL,
    valor = 1000.00, valor_base = 1000.00, "valorLiquido" = 1000.00,
    data = now() - interval '10 days', descricao = 'TESTE AJUSTE NA BAIXA';

  /* ---------------- 1. juros em reais, baixa de uma vez ---------------- */
  BEGIN
    UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id'));
    EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
      INTO v_tx;

    PERFORM public.baixar_transacao_pendente(
      p_transacao_id := v_tx,
      p_pago_em := now(),
      p_banco_id := v_banco,
      p_metodopagamento := 'PIX',
      p_ajustes := jsonb_build_array(
        jsonb_build_object('tipoId', v_tipo_juros, 'modo', 'FIXO', 'valorInformado', 50.00)
      )
    );

    SELECT valor, valor_base, valor_acrescimos, pendente, banco_id
      INTO v_valor, v_base, v_acres, v_pendente, v_banco_tx
      FROM public.transacao WHERE id = v_tx;

    SELECT count(*) INTO v_qtd FROM public.transacao_ajuste WHERE transacao_id = v_tx;

    IF v_valor = 1050.00 AND v_base = 1000.00 AND v_acres = 50.00
       AND v_pendente = false AND v_banco_tx = v_banco AND v_qtd = 1 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 1: juros de 50 na baixa -> valor %, base %, banco no titulo, % linha de ajuste',
        v_valor, v_base, v_qtd;
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 1: valor=% base=% acres=% pendente=% banco=% ajustes=%',
        v_valor, v_base, v_acres, v_pendente, v_banco_tx, v_qtd;
    END IF;

    /* ---- 1b. NÃO virou baixa parcial ----
     * É a regressão que o "reler depois do ajuste" existe para impedir. Sem a
     * releitura, v_saldo seria 1000 e pagar 1050 seria tratado como parcial: o
     * banco sairia do titulo e nasceria uma filha que ninguem pediu.
     */
    SELECT count(*) INTO v_qtd FROM public.transacao WHERE baixa_de_transacao_id = v_tx;
    IF v_qtd = 0 AND v_banco_tx IS NOT NULL THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 1b: baixa de uma vez, sem filha de baixa parcial';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 1b: nasceram % filhas e banco do titulo = %', v_qtd, v_banco_tx;
    END IF;

    /* ---- 1c. o estorno devolve o titulo ao que era ---- */
    PERFORM public.estornar_baixa_transacao(v_tx, NULL);

    SELECT valor, valor_acrescimos, pendente INTO v_valor, v_acres, v_pendente
      FROM public.transacao WHERE id = v_tx;

    IF v_valor = 1000.00 AND v_acres = 0 AND v_pendente = true THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 1c: estorno devolveu o titulo a 1000,00 e apagou o juros';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 1c: valor=% acres=% pendente=%', v_valor, v_acres, v_pendente;
    END IF;

    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN NULL;
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 1: -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 2. percentual incide sobre a base ---------------- */
  BEGIN
    UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id'));
    EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
      INTO v_tx;

    -- Um acréscimo manual antes, para provar que os 2% saem da BASE (1000) e
    -- não do bruto acumulado (1050).
    INSERT INTO public.transacao_ajuste (transacao_id, tipo_id, natureza, modo, valor_informado, valor_calculado)
    VALUES (v_tx, v_tipo_juros, 'ACRESCIMO', 'FIXO', 50.00, 50.00);

    PERFORM public.baixar_transacao_pendente(
      p_transacao_id := v_tx, p_pago_em := now(), p_banco_id := v_banco,
      p_metodopagamento := 'PIX',
      p_ajustes := jsonb_build_array(
        jsonb_build_object('tipoId', v_tipo_juros, 'modo', 'PORCENTAGEM', 'valorInformado', 2)
      )
    );

    SELECT valor_calculado INTO v_valor
      FROM public.transacao_ajuste
     WHERE transacao_id = v_tx AND modo = 'PORCENTAGEM';

    SELECT valor INTO v_base FROM public.transacao WHERE id = v_tx;

    IF v_valor = 20.00 AND v_base = 1070.00 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 2: 2%% deram % (base 1000, nao bruto 1050); titulo em %', v_valor, v_base;
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 2: calculado=% (esperava 20.00) valor=% (esperava 1070.00)', v_valor, v_base;
    END IF;

    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN NULL;
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 2: -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 3. juros e desconto na mesma baixa ---------------- */
  BEGIN
    UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id'));
    EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
      INTO v_tx;

    PERFORM public.baixar_transacao_pendente(
      p_transacao_id := v_tx, p_pago_em := now(), p_banco_id := v_banco,
      p_metodopagamento := 'PIX',
      p_ajustes := jsonb_build_array(
        jsonb_build_object('tipoId', v_tipo_juros, 'modo', 'FIXO', 'valorInformado', 50.00),
        jsonb_build_object('tipoId', v_tipo_desc, 'modo', 'FIXO', 'valorInformado', 30.00)
      )
    );

    SELECT valor, valor_acrescimos, valor_descontos, "valorLiquido"
      INTO v_valor, v_acres, v_desc, v_base
      FROM public.transacao WHERE id = v_tx;

    IF v_valor = 1050.00 AND v_acres = 50.00 AND v_desc = 30.00 AND v_base = 1020.00 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 3: bruto %, descontos %, liquido %', v_valor, v_desc, v_base;
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 3: valor=% acres=% desc=% liquido=%', v_valor, v_acres, v_desc, v_base;
    END IF;

    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN NULL;
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 3: -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 4. desconto acima do bruto: a baixa INTEIRA é desfeita ----
   *
   * É a atomicidade que justifica a feature. Recusado o ajuste, o título tem que
   * continuar pendente — não pode ficar baixado sem o desconto que a pessoa
   * pediu.
   */
  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id'));
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_tx;

  BEGIN
    PERFORM public.baixar_transacao_pendente(
      p_transacao_id := v_tx, p_pago_em := now(), p_banco_id := v_banco,
      p_metodopagamento := 'PIX',
      p_ajustes := jsonb_build_array(
        jsonb_build_object('tipoId', v_tipo_desc, 'modo', 'FIXO', 'valorInformado', 5000.00)
      )
    );
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: desconto acima do bruto foi aceito';
  EXCEPTION WHEN sqlstate '22023' THEN
    SELECT pendente INTO v_pendente FROM public.transacao WHERE id = v_tx;
    IF v_pendente = true THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 4: recusado e a baixa nao aconteceu -> %', SQLERRM;
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 4: recusou o ajuste mas baixou o titulo assim mesmo';
    END IF;
  END;

  /* ---------------- 5. tipo inexistente ---------------- */
  BEGIN
    PERFORM public.baixar_transacao_pendente(
      p_transacao_id := v_tx, p_pago_em := now(), p_banco_id := v_banco,
      p_metodopagamento := 'PIX',
      p_ajustes := jsonb_build_array(
        jsonb_build_object('tipoId', 999999, 'modo', 'FIXO', 'valorInformado', 10.00)
      )
    );
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 5: tipo inexistente foi aceito';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 5: tipo inexistente recusado -> %', SQLERRM;
  END;

  /* ---------------- 6. baixa parcial com juros ---------------- */
  BEGIN
    PERFORM public.baixar_transacao_pendente(
      p_transacao_id := v_tx, p_pago_em := now(), p_banco_id := v_banco,
      p_metodopagamento := 'PIX', p_valor := 600.00,
      p_ajustes := jsonb_build_array(
        jsonb_build_object('tipoId', v_tipo_juros, 'modo', 'FIXO', 'valorInformado', 50.00)
      )
    );

    SELECT pendente, valor_baixado, banco_id, "valorLiquido"
      INTO v_pendente, v_acres, v_banco_tx, v_valor
      FROM public.transacao WHERE id = v_tx;

    -- líquido 1050, pago 600, restam 450; o dinheiro mora na filha.
    IF v_pendente = true AND v_acres = 600.00 AND v_banco_tx IS NULL AND v_valor = 1050.00 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 6: parcial de 600 sobre o novo liquido de %; restam %', v_valor, v_valor - v_acres;
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 6: pendente=% baixado=% banco=% liquido=%',
        v_pendente, v_acres, v_banco_tx, v_valor;
    END IF;

    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN NULL;
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 6: -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 7. sem ajustes, tudo como sempre foi ----------------
   *
   * A regressão que protege os quatro chamadores que não passam p_ajustes.
   */
  BEGIN
    UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id'));
    EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
      INTO v_tx;

    PERFORM public.baixar_transacao_pendente(
      p_transacao_id := v_tx, p_pago_em := now(), p_banco_id := v_banco,
      p_metodopagamento := 'PIX'
    );

    SELECT valor, pendente, banco_id INTO v_valor, v_pendente, v_banco_tx
      FROM public.transacao WHERE id = v_tx;
    SELECT count(*) INTO v_qtd FROM public.transacao_ajuste WHERE transacao_id = v_tx;

    IF v_valor = 1000.00 AND v_pendente = false AND v_banco_tx = v_banco AND v_qtd = 0 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 7: baixa sem ajustes inalterada';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 7: valor=% pendente=% banco=% ajustes=%', v_valor, v_pendente, v_banco_tx, v_qtd;
    END IF;

    -- E com a lista vazia, idem.
    UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id'));
    EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
      INTO v_tx;

    PERFORM public.baixar_transacao_pendente(
      p_transacao_id := v_tx, p_pago_em := now(), p_banco_id := v_banco,
      p_metodopagamento := 'PIX', p_ajustes := '[]'::jsonb
    );

    SELECT valor, pendente INTO v_valor, v_pendente FROM public.transacao WHERE id = v_tx;
    IF v_valor = 1000.00 AND v_pendente = false THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 7b: lista vazia tambem nao muda nada';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 7b: valor=% pendente=%', v_valor, v_pendente;
    END IF;

    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN NULL;
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 7: -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* Desconto antes do acréscimo deve produzir o mesmo total. */
  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id'));
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols) INTO v_tx;
  PERFORM public.baixar_transacao_pendente(
    p_transacao_id := v_tx, p_pago_em := now(), p_banco_id := v_banco,
    p_metodopagamento := 'PIX', p_ajustes := jsonb_build_array(
      jsonb_build_object('tipoId', v_tipo_desc, 'modo', 'FIXO', 'valorInformado', 1100),
      jsonb_build_object('tipoId', v_tipo_juros, 'modo', 'FIXO', 'valorInformado', 200)
    )
  );
  SELECT "valorLiquido", pendente INTO v_valor, v_pendente FROM public.transacao WHERE id = v_tx;
  IF v_valor <> 100 OR v_pendente THEN RAISE EXCEPTION 'Ordem das linhas alterou o resultado.'; END IF;
  v_ok := v_ok + 1;
  RAISE NOTICE 'OK 8: desconto antes do acrescimo respeita o total final';

  /* Payload inválido e desconto integral não podem deixar uma baixa gravada. */
  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id'));
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols) INTO v_tx;
  BEGIN
    PERFORM public.baixar_transacao_pendente(v_tx, now(), v_banco, 'PIX', p_ajustes := '{}'::jsonb);
    RAISE EXCEPTION 'Payload invalido foi aceito.';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.baixar_transacao_pendente(v_tx, now(), v_banco, 'PIX',
      p_ajustes := jsonb_build_array(jsonb_build_object('tipoId', v_tipo_desc, 'modo', 'FIXO', 'valorInformado', 1000)));
    RAISE EXCEPTION 'Desconto integral foi aceito.';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  SELECT valor, pendente INTO v_valor, v_pendente FROM public.transacao WHERE id = v_tx;
  SELECT count(*) INTO v_qtd FROM public.transacao_ajuste WHERE transacao_id = v_tx;
  IF v_valor <> 1000 OR NOT v_pendente OR v_qtd <> 0 THEN RAISE EXCEPTION 'Falha deixou ajustes ou baixa gravados.'; END IF;
  v_ok := v_ok + 1;
  RAISE NOTICE 'OK 9: recusas preservam titulo pendente e sem ajustes';

  /* Conta a pagar com desconto movimenta somente o valor líquido. */
  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')), tipo = 'DESPESA';
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols) INTO v_tx;
  PERFORM public.baixar_transacao_pendente(v_tx, now(), v_banco, 'PIX',
    p_ajustes := jsonb_build_array(jsonb_build_object('tipoId', v_tipo_desc, 'modo', 'FIXO', 'valorInformado', 30)));
  SELECT "valorLiquido", pendente INTO v_valor, v_pendente FROM public.transacao WHERE id = v_tx;
  IF v_valor <> 970 OR v_pendente THEN RAISE EXCEPTION 'Desconto em despesa nao respeitou o liquido.'; END IF;
  v_ok := v_ok + 1;
  RAISE NOTICE 'OK 10: conta a pagar quitada com desconto';

  /* ---------------- resultado ---------------- */
  RAISE NOTICE '---';
  RAISE NOTICE 'OK: % | FALHOU: %', v_ok, v_falhou;
  IF v_falhou > 0 THEN
    RAISE EXCEPTION '% caso(s) falharam.', v_falhou;
  END IF;
END $$;

ROLLBACK;
