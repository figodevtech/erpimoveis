-- Teste de public.estornar_baixa_transacao contra um banco real.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/estornar_baixa_transacao.sql
--   npm run db:test:sql -- supabase/tests/estornar_baixa_transacao.sql demir
--
-- Tudo dentro de uma transação que termina em ROLLBACK: as transações de teste
-- somem no fim. Nada é escrito no banco.
--
-- As linhas são clonadas de registros existentes (tabela temporária `_molde`),
-- então o script não precisa conhecer o schema: se `transacao` ganhar uma coluna
-- NOT NULL, ele continua funcionando.

BEGIN;

DO $t$
DECLARE
  v_col_gerada text;
  v_cols text;
  v_id bigint;
  v_banco bigint;
  v_tipo_juros integer;
  v_vencimento timestamptz := date_trunc('day', now() - interval '30 days');
  v_pagamento timestamptz := date_trunc('day', now() - interval '2 days');
  v_tx public.transacao%ROWTYPE;
  v_eventos int;
  v_resultado jsonb;
  v_ok int := 0;
  v_falhou int := 0;
BEGIN
  /* ---------------- pré-requisitos ---------------- */

  IF to_regprocedure('public.estornar_baixa_transacao(bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION 'A funcao de estorno nao existe. Rode as migrations primeiro.';
  END IF;

  -- A regra nova depende de a chave unica ter saido: baixar, estornar e baixar
  -- de novo grava duas linhas de BAIXA para o mesmo titulo.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.transacao_baixa_historico'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) ILIKE '%(transacao_id)%'
  ) THEN
    RAISE EXCEPTION 'transacao_baixa_historico ainda tem UNIQUE (transacao_id).';
  END IF;

  SELECT id INTO v_banco FROM public.bancoconta ORDER BY id LIMIT 1;
  IF v_banco IS NULL THEN
    RAISE EXCEPTION 'Nenhum banco cadastrado para servir de destino.';
  END IF;

  /* ---------------- fixture: um titulo a pagar, em aberto ---------------- */

  CREATE TEMP TABLE _molde ON COMMIT DROP AS
    SELECT * FROM public.transacao WHERE is_deleted = false LIMIT 1;

  /*
   * Coluna gerada nao se insere: `data_dia` (20260901220000) veio depois deste
   * teste e passou a entrar no `SELECT *` do molde, quebrando todos os inserts
   * com "cannot insert a non-DEFAULT value". Some do molde e a lista de colunas
   * passa a ser explicita — o script continua sem conhecer o schema, e uma
   * coluna gerada nova amanha tambem nao o quebra.
   */
  FOR v_col_gerada IN
    SELECT a.attname
      FROM pg_attribute a
     WHERE a.attrelid = '_molde'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND a.attname IN (
         SELECT b.attname FROM pg_attribute b
          WHERE b.attrelid = 'public.transacao'::regclass
            AND b.attgenerated <> ''
       )
  LOOP
    EXECUTE format('ALTER TABLE _molde DROP COLUMN %I', v_col_gerada);
  END LOOP;

  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = '_molde'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;
  IF (SELECT count(*) FROM _molde) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma transacao para servir de molde.';
  END IF;

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    ordemservicoid = NULL, vendaid = NULL, entrada_id = NULL, usoconsumo_entrada_id = NULL,
    evento_financeiro_id = NULL, estorno_transacao_id = NULL, pagamento_multiplo_id = NULL,
    adiantamento_id = NULL, eh_adiantamento = false, parcelamento_id = NULL,
    is_deleted = false, pendente = true,
    tipo = 'DESPESA'::public.tipos_transacao,
    valor = 304.27, valor_base = 304.27, "valorLiquido" = 304.27,
    valor_acrescimos = 0, valor_descontos = 0,
    banco_id = v_banco, vencimento_em = NULL, pago_em = NULL, baixado_por = NULL,
    data = v_vencimento, descricao = 'TESTE ESTORNO DE BAIXA';
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde', v_cols, v_cols);
  SELECT id INTO v_id FROM _molde;

  /* ---------------- 1. juros so entram enquanto o titulo esta em aberto ---------------- */

  SELECT id INTO v_tipo_juros
    FROM public.tipos_ajuste_transacao
   WHERE natureza = 'ACRESCIMO' AND ativo IS TRUE
   ORDER BY id LIMIT 1;

  IF v_tipo_juros IS NOT NULL THEN
    INSERT INTO public.transacao_ajuste
      (transacao_id, tipo_id, natureza, modo, valor_informado, valor_calculado, observacao)
    VALUES (v_id, v_tipo_juros, 'ACRESCIMO', 'FIXO', 7.09, 7.09, 'Juros do teste');

    SELECT * INTO v_tx FROM public.transacao WHERE id = v_id;
    IF round(v_tx.valor, 2) = 311.36 AND round(v_tx.valor_acrescimos, 2) = 7.09 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 1: acrescimo levou o titulo de 304,27 para %', v_tx.valor;
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 1: valor ficou % (esperado 311.36)', v_tx.valor;
    END IF;
  ELSE
    RAISE NOTICE 'PULADO 1: nenhum tipo de acrescimo ativo cadastrado.';
  END IF;

  /* ---------------- 2. a baixa ---------------- */

  PERFORM public.baixar_transacao_pendente(v_id, v_pagamento, v_banco, 'PIX', NULL, NULL, NULL);

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_id;
  IF v_tx.pendente = false AND v_tx.pago_em = v_pagamento AND v_tx.data = v_pagamento
     AND v_tx.vencimento_em = v_vencimento THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: baixou, guardou o vencimento e levou `data` para o dia do pagamento';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 2: pendente=%, pago_em=%, data=%, vencimento_em=%',
      v_tx.pendente, v_tx.pago_em, v_tx.data, v_tx.vencimento_em;
  END IF;

  /* ---------------- 3. o estorno ---------------- */

  v_resultado := public.estornar_baixa_transacao(v_id, NULL);

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_id;

  IF v_tx.pendente = true AND v_tx.pago_em IS NULL AND v_tx.baixado_por IS NULL
     AND v_tx.data = v_vencimento THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: titulo voltou a em aberto, vencendo no dia original (%)', v_tx.data::date;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: pendente=%, pago_em=%, data=% (esperado %)',
      v_tx.pendente, v_tx.pago_em, v_tx.data, v_vencimento;
  END IF;

  /* ---------------- 4. os juros sairam junto com o pagamento ---------------- */

  IF round(v_tx.valor, 2) = 304.27 AND round(coalesce(v_tx.valor_acrescimos, 0), 2) = 0
     AND NOT EXISTS (
       SELECT 1 FROM public.transacao_ajuste
        WHERE transacao_id = v_id AND natureza = 'ACRESCIMO'
     ) THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: titulo reabriu por 304,27, sem acrescimo (removidos: %)',
      v_resultado ->> 'acrescimos_removidos';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: valor=%, acrescimos=%', v_tx.valor, v_tx.valor_acrescimos;
  END IF;

  /* ---------------- 5. o livro guarda os dois fatos ---------------- */

  SELECT count(*) INTO v_eventos
    FROM public.transacao_baixa_historico WHERE transacao_id = v_id;

  IF v_eventos = 2
     AND EXISTS (SELECT 1 FROM public.transacao_baixa_historico
                  WHERE transacao_id = v_id AND operacao = 'BAIXA')
     AND EXISTS (SELECT 1 FROM public.transacao_baixa_historico
                  WHERE transacao_id = v_id AND operacao = 'ESTORNO') THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 5: historico tem a baixa e o estorno lado a lado';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 5: historico tem % linha(s)', v_eventos;
  END IF;

  /* ---------------- 6. baixar de novo, que a chave unica proibia ---------------- */

  BEGIN
    PERFORM public.baixar_transacao_pendente(v_id, now(), v_banco, 'PIX', NULL, NULL, NULL);
    SELECT count(*) INTO v_eventos
      FROM public.transacao_baixa_historico WHERE transacao_id = v_id;
    IF v_eventos = 3 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 6: rebaixou depois do estorno; livro com 3 eventos';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 6: livro ficou com % eventos', v_eventos;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 6: rebaixar ainda estoura violacao de unicidade';
  END;

  /* ---------------- 7. estornar o que nao esta liquidado e recusado ---------------- */

  PERFORM public.estornar_baixa_transacao(v_id, NULL);  -- reabre de novo

  BEGIN
    PERFORM public.estornar_baixa_transacao(v_id, NULL);
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 7: estornou um titulo que ja estava em aberto';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm ILIKE '%nao esta liquidada%' OR sqlerrm ILIKE '%não está liquidada%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 7: recusou estornar titulo em aberto';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 7: recusou com outra mensagem: %', sqlerrm;
    END IF;
  END;

  RAISE NOTICE '---';
  RAISE NOTICE '=== % passaram, % falharam ===', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Ha % verificacoes falhando.', v_falhou;
  END IF;
END $t$;

-- Nada acima é persistido.
ROLLBACK;
