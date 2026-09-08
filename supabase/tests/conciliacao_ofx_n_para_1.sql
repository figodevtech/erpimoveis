-- Conciliação N:1 — várias linhas do extrato para um lançamento só do ERP.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/conciliacao_ofx_n_para_1.sql
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito.
--
-- O QUE ENCENA
-- O caso real: o banco cobra a prestação do financiamento numa linha
-- (R$ 743,16) e o IOF do mesmo contrato noutra (R$ 161,01), no mesmo dia, e o
-- ERP tem uma despesa só de R$ 904,17. Antes não havia como conciliar isso.
--
-- OS INVARIANTES
--   * a soma das linhas do grupo é o valor conferido contra a transação;
--   * soma diferente é recusada — o grupo não é um jeito de fechar o extrato
--     com o valor errado;
--   * entradas e saídas não se compensam no mesmo grupo;
--   * a transação continua respondendo por UM ato de conciliação: o grupo é a
--     exceção nomeada, não a porta aberta;
--   * numa baixa em grupo sai UMA baixa do total, não uma por linha;
--   * a assinatura de um movimento só continua valendo, pela fachada.

BEGIN;

CREATE TEMP TABLE _criadas (id bigint PRIMARY KEY) ON COMMIT DROP;

DO $t$
DECLARE
  v_banco bigint;
  v_importacao bigint;
  v_registro jsonb;
  v_resultado jsonb;
  v_liquidada bigint;
  v_liquidada2 bigint;
  v_titulo bigint;
  v_mov_a bigint;
  v_mov_b bigint;
  v_mov_c bigint;
  v_mov_credito bigint;
  v_mov_e bigint;
  v_mov_f bigint;
  v_mov_g bigint;
  v_tx public.transacao%ROWTYPE;
  v_n int;
  v_erro text;
  v_hash text := 'hash-n1-' || gen_random_uuid()::text;
  v_dia date := (now() AT TIME ZONE '-03:00')::date;
  v_instante timestamptz := ((now() AT TIME ZONE '-03:00')::date::text || ' 12:00:00-03')::timestamptz;
  v_ok int := 0;
  v_falhou int := 0;
BEGIN
  IF to_regprocedure('public.conciliar_movimentos_ofx(bigint[],text,bigint,numeric,text,integer,integer,jsonb,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'conciliar_movimentos_ofx não existe. Rode as migrations.';
  END IF;

  SELECT id INTO v_banco FROM public.bancoconta ORDER BY id LIMIT 1;
  IF v_banco IS NULL THEN RAISE EXCEPTION 'Nenhum banco cadastrado.'; END IF;

  /* ---------------------------------------------------------- fixture */

  -- A despesa única de R$ 904,17 que o ERP lançou: prestação + IOF juntos.
  INSERT INTO public.transacao (
    descricao, valor, valor_base, "valorLiquido", valor_acrescimos, valor_descontos,
    data, competencia_em, vencimento_em, pago_em,
    tipo, pendente, banco_id, metodopagamento, categoria,
    nomepagador, cpfcnpjpagador
  ) VALUES (
    'TESTE N1 PRESTACAO COM IOF', 904.17, 904.17, 904.17, 0, 0,
    v_instante, v_instante, v_instante, v_instante,
    'DESPESA'::public.tipos_transacao, false, v_banco, 'BOLETO'::public.metodo_pagamento,
    'NÃO RELACIONADO', 'TESTE N1', ''
  ) RETURNING id INTO v_liquidada;
  INSERT INTO _criadas VALUES (v_liquidada);

  INSERT INTO public.transacao (
    descricao, valor, valor_base, "valorLiquido", valor_acrescimos, valor_descontos,
    data, competencia_em, vencimento_em, pago_em,
    tipo, pendente, banco_id, metodopagamento, categoria,
    nomepagador, cpfcnpjpagador
  ) VALUES (
    'TESTE N1 OUTRA DE MESMO VALOR', 904.17, 904.17, 904.17, 0, 0,
    v_instante, v_instante, v_instante, v_instante,
    'DESPESA'::public.tipos_transacao, false, v_banco, 'BOLETO'::public.metodo_pagamento,
    'NÃO RELACIONADO', 'TESTE N1', ''
  ) RETURNING id INTO v_liquidada2;
  INSERT INTO _criadas VALUES (v_liquidada2);

  -- O mesmo caso, mas como título em aberto: a baixa em grupo.
  INSERT INTO public.transacao (
    descricao, valor, valor_base, "valorLiquido", valor_acrescimos, valor_descontos,
    data, competencia_em, vencimento_em,
    tipo, pendente, categoria, nomepagador, cpfcnpjpagador
  ) VALUES (
    'TESTE N1 TITULO PRESTACAO COM IOF', 904.17, 904.17, 904.17, 0, 0,
    v_instante, v_instante, v_instante,
    'DESPESA'::public.tipos_transacao, true, 'NÃO RELACIONADO', 'TESTE N1', ''
  ) RETURNING id INTO v_titulo;
  INSERT INTO _criadas VALUES (v_titulo);

  /* ------------------------------------------------------- importação */

  v_registro := public.registrar_importacao_ofx(
    v_banco, 'EXTRATO N1 TESTE.OFX', v_hash,
    jsonb_build_object(
      'bankId','104','branchId','1234','acctId','000012345-6',
      'acctType','CHECKING','moeda','BRL',
      'periodoInicio', v_dia::text, 'periodoFim', v_dia::text,
      'saldoInicial','1000.00','saldoFinal','2000.00'
    ),
    jsonb_build_array(
      jsonb_build_object('sequencia',1,'fitid','N1','tipoOfx','DEBIT',
        'dataPostagem', v_dia::text, 'valorCentavos', -74316,
        'memo','PREST. DE EMPREST. FINANCIAMENTO CONTRATO 290000000700',
        'fingerprint','fp-prest-' || v_hash,'situacao','SEM_CORRESPONDENCIA','score',0),
      jsonb_build_object('sequencia',2,'fitid','N2','tipoOfx','DEBIT',
        'dataPostagem', v_dia::text, 'valorCentavos', -16101,
        'memo','IOF IMPOSTO OPERACOES FINANCEIRAS CONTRATO 290000000700',
        'fingerprint','fp-iof-' || v_hash,'situacao','SEM_CORRESPONDENCIA','score',0),
      jsonb_build_object('sequencia',3,'fitid','N3','tipoOfx','DEBIT',
        'dataPostagem', v_dia::text, 'valorCentavos', -74316,
        'memo','OUTRA PRESTACAO DE MESMO VALOR',
        'fingerprint','fp-prest2-' || v_hash,'situacao','SEM_CORRESPONDENCIA','score',0),
      jsonb_build_object('sequencia',4,'fitid','N4','tipoOfx','CREDIT',
        'dataPostagem', v_dia::text, 'valorCentavos', 10000,
        'memo','PIX RECEBIDO',
        'fingerprint','fp-credito-' || v_hash,'situacao','SEM_CORRESPONDENCIA','score',0),
      jsonb_build_object('sequencia',5,'fitid','N5','tipoOfx','DEBIT',
        'dataPostagem', v_dia::text, 'valorCentavos', -74316,
        'memo','PREST. DE EMPREST. PARA BAIXA',
        'fingerprint','fp-prest3-' || v_hash,'situacao','SEM_CORRESPONDENCIA','score',0),
      jsonb_build_object('sequencia',6,'fitid','N6','tipoOfx','DEBIT',
        'dataPostagem', v_dia::text, 'valorCentavos', -16101,
        'memo','IOF PARA BAIXA',
        'fingerprint','fp-iof2-' || v_hash,'situacao','SEM_CORRESPONDENCIA','score',0),
      jsonb_build_object('sequencia',7,'fitid','N7','tipoOfx','DEBIT',
        'dataPostagem', v_dia::text, 'valorCentavos', -90417,
        'memo','PRESTACAO COBRADA EM LINHA UNICA',
        'fingerprint','fp-inteiro-' || v_hash,'situacao','SEM_CORRESPONDENCIA','score',0)
    ),
    NULL
  );

  v_importacao := (v_registro->>'importacao_id')::bigint;

  SELECT id INTO v_mov_a FROM public.ofx_movimento WHERE importacao_id = v_importacao AND sequencia = 1;
  SELECT id INTO v_mov_b FROM public.ofx_movimento WHERE importacao_id = v_importacao AND sequencia = 2;
  SELECT id INTO v_mov_c FROM public.ofx_movimento WHERE importacao_id = v_importacao AND sequencia = 3;
  SELECT id INTO v_mov_credito FROM public.ofx_movimento WHERE importacao_id = v_importacao AND sequencia = 4;
  SELECT id INTO v_mov_e FROM public.ofx_movimento WHERE importacao_id = v_importacao AND sequencia = 5;
  SELECT id INTO v_mov_f FROM public.ofx_movimento WHERE importacao_id = v_importacao AND sequencia = 6;
  SELECT id INTO v_mov_g FROM public.ofx_movimento WHERE importacao_id = v_importacao AND sequencia = 7;

  /* ------------------------------- 1) o caso: duas linhas, um lançamento */

  SELECT count(*) INTO v_n FROM public.transacao WHERE is_deleted = false AND banco_id = v_banco;

  v_resultado := public.conciliar_movimentos_ofx(
    ARRAY[v_mov_a, v_mov_b], 'VINCULAR', v_liquidada,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL);

  IF (v_resultado->>'transacao_id')::bigint = v_liquidada
     AND (SELECT count(*) FROM public.ofx_movimento
           WHERE id IN (v_mov_a, v_mov_b)
             AND status = 'CONCILIADO' AND transacao_id = v_liquidada) = 2
     AND (SELECT count(*) FROM public.transacao
           WHERE is_deleted = false AND banco_id = v_banco) = v_n THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: 743,16 + 161,01 conciliaram a despesa de 904,17, sem criar nada';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: o grupo não fechou a transação de 904,17';
  END IF;

  /* ------------------------------------------ 2) soma diferente é recusada */

  BEGIN
    v_resultado := public.conciliar_movimentos_ofx(
      ARRAY[v_mov_c, v_mov_e], 'VINCULAR', v_liquidada2,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    v_erro := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;

  IF v_erro IS NOT NULL AND v_erro LIKE '%soma%' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: soma de 1.486,32 recusada contra transação de 904,17';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 2: grupo com soma errada foi aceito (erro: %)', coalesce(v_erro, 'nenhum');
  END IF;

  /* ------------------------------- 3) entrada e saída não se compensam */

  BEGIN
    v_resultado := public.conciliar_movimentos_ofx(
      ARRAY[v_mov_c, v_mov_credito], 'VINCULAR', v_liquidada2,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    v_erro := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;

  IF v_erro IS NOT NULL AND v_erro LIKE '%mesmo sentido%' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: crédito e débito no mesmo grupo foram recusados';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: sentidos opostos foram somados (erro: %)', coalesce(v_erro, 'nenhum');
  END IF;

  /* --------------------------- 4) linha já resolvida não entra noutro grupo */

  BEGIN
    v_resultado := public.conciliar_movimentos_ofx(
      ARRAY[v_mov_a, v_mov_c], 'VINCULAR', v_liquidada2,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    v_erro := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;

  IF v_erro IS NOT NULL AND v_erro LIKE '%já foi resolvido%' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: movimento já conciliado não entra em outro grupo';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: linha resolvida foi reaproveitada (erro: %)', coalesce(v_erro, 'nenhum');
  END IF;

  /* ------------- 5) a transação continua respondendo por um ato só */

  BEGIN
    v_resultado := public.conciliar_movimento_ofx(
      v_mov_c, 'VINCULAR', v_liquidada, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    v_erro := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;

  IF v_erro IS NOT NULL AND v_erro LIKE '%já responde por outro movimento%' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 5: transação já reivindicada pelo grupo recusa vínculo novo';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 5: a proteção que era do índice único sumiu (erro: %)', coalesce(v_erro, 'nenhum');
  END IF;

  /* --------------------------- 6) baixa em grupo: UMA baixa, do total */

  SELECT count(*) INTO v_n FROM public.transacao
   WHERE is_deleted = false AND baixa_de_transacao_id = v_titulo;

  v_resultado := public.conciliar_movimentos_ofx(
    ARRAY[v_mov_e, v_mov_f], 'LIQUIDAR', v_titulo,
    NULL, 'BOLETO', NULL, NULL, NULL, NULL, NULL);

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_titulo;

  IF v_tx.pendente = false
     AND (SELECT count(*) FROM public.ofx_movimento
           WHERE id IN (v_mov_e, v_mov_f)
             AND status = 'CONCILIADO'
             AND titulo_origem_id = v_titulo
             AND transacao_id = (v_resultado->>'transacao_id')::bigint) = 2
     AND (SELECT count(*) FROM public.transacao
           WHERE is_deleted = false AND baixa_de_transacao_id = v_titulo) = v_n THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 6: as duas linhas deram UMA baixa de 904,17 e fecharam o título';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 6: baixa em grupo saiu errada (pendente=%, baixas filhas a mais=%)',
      v_tx.pendente,
      (SELECT count(*) FROM public.transacao
        WHERE is_deleted = false AND baixa_de_transacao_id = v_titulo) - v_n;
  END IF;

  /* ------------------ 7) a assinatura de um movimento só continua valendo */

  v_resultado := public.conciliar_movimento_ofx(
    v_mov_g, 'VINCULAR', v_liquidada2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

  IF (v_resultado->>'transacao_id')::bigint = v_liquidada2
     AND (SELECT status FROM public.ofx_movimento WHERE id = v_mov_g) = 'CONCILIADO' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 7: a fachada de uma linha só continua conciliando';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 7: a conciliação de um movimento só quebrou';
  END IF;

  /* ------------------------------ 8) grupo vazio ou nulo não faz nada */

  BEGIN
    v_resultado := public.conciliar_movimentos_ofx(
      ARRAY[]::bigint[], 'IGNORAR', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    v_erro := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;

  IF v_erro IS NOT NULL AND v_erro LIKE '%ao menos um movimento%' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 8: conjunto vazio é recusado com frase própria';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 8: conjunto vazio passou (erro: %)', coalesce(v_erro, 'nenhum');
  END IF;

  RAISE NOTICE '---';
  RAISE NOTICE '=== % passaram, % falharam ===', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Ha % verificacoes falhando.', v_falhou;
  END IF;
END $t$;

ROLLBACK;
