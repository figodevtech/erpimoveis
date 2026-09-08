-- Conciliação bancária por OFX, contra um banco real.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/conciliacao_bancaria_ofx.sql
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito.
--
-- O QUE ENCENA
-- Um extrato de seis linhas na mesma conta, cobrindo os quatro caminhos da RPC:
-- vincular um movimento que já está no Fluxo, dar baixa num título em aberto,
-- dar baixa PARCIAL, criar a transação que faltava e ignorar uma linha. Depois
-- reimporta o mesmo arquivo e um arquivo diferente com período sobreposto.
--
-- OS INVARIANTES
--   * conciliar não duplica receita nem despesa;
--   * a baixa é a mesma de sempre — a RPC de conciliação chama a de baixa;
--   * numa baixa parcial o movimento aponta para a transação FILHA, e o título
--     continua em aberto pelo saldo;
--   * o mesmo movimento não entra duas vezes, nem pelo mesmo arquivo nem por
--     outro com período sobreposto;
--   * uma transação responde por um movimento só;
--   * movimento já resolvido não é conciliado de novo.

BEGIN;

CREATE TEMP TABLE _criadas (id bigint PRIMARY KEY) ON COMMIT DROP;

DO $t$
DECLARE
  v_banco bigint;
  v_importacao bigint;
  v_registro jsonb;
  v_resultado jsonb;
  v_liquidada bigint;
  v_titulo bigint;
  v_titulo_parcial bigint;
  v_titulo_pequeno bigint;
  v_mov_vincular bigint;
  v_mov_liquidar bigint;
  v_mov_parcial bigint;
  v_mov_criar bigint;
  v_mov_ignorar bigint;
  v_mov_duplicado bigint;
  v_mov_mesmo_valor bigint;
  v_filha bigint;
  v_tx public.transacao%ROWTYPE;
  v_n int;
  v_hash text := 'hash-teste-' || gen_random_uuid()::text;
  v_hash2 text := 'hash-teste-' || gen_random_uuid()::text;
  v_dia date := (now() AT TIME ZONE '-03:00')::date;
  v_instante timestamptz := ((now() AT TIME ZONE '-03:00')::date::text || ' 12:00:00-03')::timestamptz;
  v_ok int := 0;
  v_falhou int := 0;
BEGIN
  IF to_regprocedure('public.conciliar_movimento_ofx(bigint,text,bigint,numeric,text,integer,integer,jsonb,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'conciliar_movimento_ofx não existe. Rode as migrations.';
  END IF;
  IF to_regprocedure('public.registrar_importacao_ofx(bigint,text,text,jsonb,jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION 'registrar_importacao_ofx não existe. Rode as migrations.';
  END IF;

  SELECT id INTO v_banco FROM public.bancoconta ORDER BY id LIMIT 1;
  IF v_banco IS NULL THEN RAISE EXCEPTION 'Nenhum banco cadastrado.'; END IF;

  /* ---------------------------------------------------------- fixture */
  --
  -- Colunas explícitas em vez de clonar uma linha existente: `data_dia` é
  -- coluna gerada e não aceita valor, então `INSERT ... SELECT *` não passa.

  INSERT INTO public.transacao (
    descricao, valor, valor_base, "valorLiquido", valor_acrescimos, valor_descontos,
    data, competencia_em, vencimento_em, pago_em,
    tipo, pendente, banco_id, metodopagamento, categoria,
    nomepagador, cpfcnpjpagador
  ) VALUES (
    'TESTE OFX DESPESA JA LIQUIDADA', 4118.00, 4118.00, 4118.00, 0, 0,
    v_instante, v_instante, v_instante, v_instante,
    'DESPESA'::public.tipos_transacao, false, v_banco, 'BOLETO'::public.metodo_pagamento,
    'NÃO RELACIONADO', 'TESTE OFX', ''
  ) RETURNING id INTO v_liquidada;
  INSERT INTO _criadas VALUES (v_liquidada);

  INSERT INTO public.transacao (
    descricao, valor, valor_base, "valorLiquido", valor_acrescimos, valor_descontos,
    data, competencia_em, vencimento_em,
    tipo, pendente, categoria, nomepagador, cpfcnpjpagador
  ) VALUES (
    'TESTE OFX TITULO A PAGAR', 5835.69, 5835.69, 5835.69, 0, 0,
    v_instante + interval '1 day', v_instante, v_instante + interval '1 day',
    'DESPESA'::public.tipos_transacao, true, 'NÃO RELACIONADO', 'TESTE OFX', ''
  ) RETURNING id INTO v_titulo;
  INSERT INTO _criadas VALUES (v_titulo);

  INSERT INTO public.transacao (
    descricao, valor, valor_base, "valorLiquido", valor_acrescimos, valor_descontos,
    data, competencia_em, vencimento_em,
    tipo, pendente, categoria, nomepagador, cpfcnpjpagador
  ) VALUES (
    'TESTE OFX TITULO A RECEBER PARCIAL', 5000.00, 5000.00, 5000.00, 0, 0,
    v_instante, v_instante, v_instante,
    'RECEITA'::public.tipos_transacao, true, 'NÃO RELACIONADO', 'TESTE OFX', ''
  ) RETURNING id INTO v_titulo_parcial;
  INSERT INTO _criadas VALUES (v_titulo_parcial);

  -- Título a pagar pequeno, para provar que o valor da baixa tem que ser
  -- exatamente o do extrato.
  INSERT INTO public.transacao (
    descricao, valor, valor_base, "valorLiquido", valor_acrescimos, valor_descontos,
    data, competencia_em, vencimento_em,
    tipo, pendente, categoria, nomepagador, cpfcnpjpagador
  ) VALUES (
    'TESTE OFX TITULO A PAGAR PEQUENO', 100.00, 100.00, 100.00, 0, 0,
    v_instante, v_instante, v_instante,
    'DESPESA'::public.tipos_transacao, true, 'NÃO RELACIONADO', 'TESTE OFX', ''
  ) RETURNING id INTO v_titulo_pequeno;
  INSERT INTO _criadas VALUES (v_titulo_pequeno);

  /* ------------------------------------------------------- importação */

  v_registro := public.registrar_importacao_ofx(
    v_banco, 'EXTRATO TESTE.OFX', v_hash,
    jsonb_build_object(
      'bankId','104','branchId','1234','acctId','000012345-6',
      'acctType','CHECKING','moeda','BRL',
      'periodoInicio', v_dia::text, 'periodoFim', (v_dia + 1)::text,
      'saldoInicial','1000.00','saldoFinal','2000.00'
    ),
    jsonb_build_array(
      jsonb_build_object('sequencia',1,'fitid','F1','tipoOfx','DEBIT',
        'dataPostagem', v_dia::text, 'valorCentavos', -411800,
        'memo','PAGAMENTO DIVERSOS','fingerprint','fp-vincular-' || v_hash,
        'situacao','MATCH_EXATO','score',100),
      jsonb_build_object('sequencia',2,'fitid','F2','tipoOfx','DEBIT',
        'dataPostagem', v_dia::text, 'valorCentavos', -583569,
        'memo','PAGAMENTO DE BOLETO','fingerprint','fp-liquidar-' || v_hash,
        'situacao','MATCH_PROVAVEL','score',95),
      jsonb_build_object('sequencia',3,'fitid','F3','tipoOfx','CREDIT',
        'dataPostagem', v_dia::text, 'valorCentavos', 200000,
        'memo','CRED PIX CLIENTE','fingerprint','fp-parcial-' || v_hash,
        'situacao','MATCH_PROVAVEL','score',90),
      jsonb_build_object('sequencia',4,'fitid','F4','tipoOfx','DEBIT',
        'dataPostagem', v_dia::text, 'valorCentavos', -3157,
        'memo','DEBITO DE IOF','fingerprint','fp-criar-' || v_hash,
        'situacao','SEM_CORRESPONDENCIA','score',0),
      jsonb_build_object('sequencia',5,'fitid','F5','tipoOfx','DEBIT',
        'dataPostagem', v_dia::text, 'valorCentavos', -290,
        'memo','TARIFA BANCARIA','fingerprint','fp-ignorar-' || v_hash,
        'situacao','SEM_CORRESPONDENCIA','score',0),
      -- Mesma linha da anterior repetida no arquivo: dois fatos, e o
      -- fingerprint que o TypeScript gera já os separa pela ocorrência.
      jsonb_build_object('sequencia',6,'fitid','F5','tipoOfx','DEBIT',
        'dataPostagem', v_dia::text, 'valorCentavos', -290,
        'memo','TARIFA BANCARIA','fingerprint','fp-ignorar2-' || v_hash,
        'situacao','SEM_CORRESPONDENCIA','score',0),
      -- Mesmo valor e mesmo dia da linha 1, que já foi vinculada: serve para
      -- provar que uma transação não responde por dois movimentos.
      jsonb_build_object('sequencia',7,'fitid','F7','tipoOfx','DEBIT',
        'dataPostagem', v_dia::text, 'valorCentavos', -411800,
        'memo','OUTRO PAGAMENTO DE MESMO VALOR','fingerprint','fp-mesmovalor-' || v_hash,
        'situacao','AMBIGUO','score',100)
    ),
    NULL
  );

  v_importacao := (v_registro->>'importacao_id')::bigint;

  IF (v_registro->>'quantidade_importados')::int = 7
     AND (v_registro->>'quantidade_repetidos')::int = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: as sete linhas do extrato entraram';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: entraram % de 7', v_registro->>'quantidade_importados';
  END IF;

  SELECT id INTO v_mov_vincular FROM public.ofx_movimento
   WHERE importacao_id = v_importacao AND sequencia = 1;
  SELECT id INTO v_mov_liquidar FROM public.ofx_movimento
   WHERE importacao_id = v_importacao AND sequencia = 2;
  SELECT id INTO v_mov_parcial FROM public.ofx_movimento
   WHERE importacao_id = v_importacao AND sequencia = 3;
  SELECT id INTO v_mov_criar FROM public.ofx_movimento
   WHERE importacao_id = v_importacao AND sequencia = 4;
  SELECT id INTO v_mov_ignorar FROM public.ofx_movimento
   WHERE importacao_id = v_importacao AND sequencia = 5;
  SELECT id INTO v_mov_duplicado FROM public.ofx_movimento
   WHERE importacao_id = v_importacao AND sequencia = 6;
  SELECT id INTO v_mov_mesmo_valor FROM public.ofx_movimento
   WHERE importacao_id = v_importacao AND sequencia = 7;

  /* -------------------------------------------- 1) vincular ao Fluxo */

  SELECT count(*) INTO v_n FROM public.transacao
   WHERE is_deleted = false AND banco_id = v_banco AND pendente = false;

  v_resultado := public.conciliar_movimento_ofx(
    v_mov_vincular, 'VINCULAR', v_liquidada, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

  IF (v_resultado->>'transacao_id')::bigint = v_liquidada
     AND (SELECT count(*) FROM public.transacao
           WHERE is_deleted = false AND banco_id = v_banco AND pendente = false) = v_n THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: vincular não criou transação nenhuma';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 2: vincular duplicou o movimento no Fluxo';
  END IF;

  /* -------------------------------------------- 2) liquidar o título */

  v_resultado := public.conciliar_movimento_ofx(
    v_mov_liquidar, 'LIQUIDAR', v_titulo, NULL, 'BOLETO', NULL, NULL, NULL, NULL, NULL);

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_titulo;
  IF v_tx.pendente = false
     AND v_tx.banco_id = v_banco
     AND (v_tx.pago_em AT TIME ZONE '-03:00')::date = v_dia
     AND (v_resultado->>'transacao_id')::bigint = v_titulo THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: o título saiu de aberto com a conta e a data do extrato';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: pendente=%, banco=%, pago_em=%',
      v_tx.pendente, v_tx.banco_id, v_tx.pago_em;
  END IF;

  SELECT count(*) INTO v_n FROM public.transacao
   WHERE baixa_de_transacao_id = v_titulo AND is_deleted = false;
  IF v_n = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: baixa integral não criou segunda despesa';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: a baixa integral criou % transação filha', v_n;
  END IF;

  /* ---------------------------------------------- 3) baixa parcial */

  v_resultado := public.conciliar_movimento_ofx(
    v_mov_parcial, 'LIQUIDAR', v_titulo_parcial, 2000.00, 'PIX', NULL, NULL, NULL, NULL, NULL);

  v_filha := (v_resultado->>'transacao_id')::bigint;
  SELECT * INTO v_tx FROM public.transacao WHERE id = v_titulo_parcial;

  IF v_resultado->>'acao' = 'BAIXA_PARCIAL'
     AND v_tx.pendente = true
     AND round(v_tx.valor_baixado, 2) = 2000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 5: o título continua aberto pelo saldo de R$ 3.000';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 5: acao=%, pendente=%, baixado=%',
      v_resultado->>'acao', v_tx.pendente, v_tx.valor_baixado;
  END IF;

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_filha;
  IF v_tx.baixa_de_transacao_id = v_titulo_parcial
     AND v_tx.banco_id = v_banco
     AND round(v_tx.valor, 2) = 2000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 6: o movimento aponta para a transação filha, que é o dinheiro';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 6: a filha da baixa parcial não é o vínculo do movimento';
  END IF;

  SELECT count(*) INTO v_n FROM public.ofx_movimento
   WHERE id = v_mov_parcial AND titulo_origem_id = v_titulo_parcial;
  IF v_n = 1 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 7: titulo_origem_id aponta para o título original';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 7: titulo_origem_id não aponta para o título';
  END IF;

  /* ------------------------------------------- 4) criar transação */

  v_resultado := public.conciliar_movimento_ofx(
    v_mov_criar, 'CRIAR', NULL, NULL, 'DEBITO AUTOMATICO', NULL, NULL,
    jsonb_build_object('descricao','DEBITO DE IOF'), NULL, NULL);

  SELECT * INTO v_tx FROM public.transacao WHERE id = (v_resultado->>'transacao_id')::bigint;
  INSERT INTO _criadas VALUES (v_tx.id);

  IF upper(v_tx.tipo::text) = 'DESPESA'
     AND v_tx.pendente = false
     AND v_tx.banco_id = v_banco
     AND round(v_tx.valor, 2) = 31.57 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 8: o débito do extrato virou despesa liquidada na conta';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 8: tipo=%, pendente=%, valor=%',
      v_tx.tipo, v_tx.pendente, v_tx.valor;
  END IF;

  /* --------------------------------------------------- 5) ignorar */

  v_resultado := public.conciliar_movimento_ofx(
    v_mov_ignorar, 'IGNORAR', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Tarifa sem lançamento');

  SELECT count(*) INTO v_n FROM public.ofx_movimento
   WHERE id = v_mov_ignorar AND status = 'IGNORADO' AND transacao_id IS NULL;
  IF v_n = 1 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 9: o movimento ignorado fica registrado e sem transação';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 9: o ignorado não ficou no estado certo';
  END IF;

  /* ------------------------------------------ conciliação em dobro */

  BEGIN
    PERFORM public.conciliar_movimento_ofx(
      v_mov_vincular, 'VINCULAR', v_liquidada, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 10: conciliou o mesmo movimento duas vezes';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 10: movimento já resolvido é recusado (%)', SQLERRM;
  END;

  BEGIN
    PERFORM public.conciliar_movimento_ofx(
      v_mov_mesmo_valor, 'VINCULAR', v_liquidada, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 11: uma transação respondeu por dois movimentos';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 11: transação já conciliada é recusada (%)', SQLERRM;
  END;

  SELECT count(*) INTO v_n FROM public.ofx_movimento
   WHERE id = v_mov_mesmo_valor AND status = 'PENDENTE' AND transacao_id IS NULL;
  IF v_n = 1 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 11b: a recusa deixou o movimento em aberto, sem vínculo';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 11b: a recusa gravou vínculo pela metade';
  END IF;

  /* ------------------------------------------ o valor tem que bater */

  BEGIN
    PERFORM public.conciliar_movimento_ofx(
      v_mov_duplicado, 'LIQUIDAR', v_titulo_pequeno, 100.00, 'BOLETO',
      NULL, NULL, NULL, NULL, NULL);
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 12: baixou R$ 100 com um movimento de R$ 2,90';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 12: baixa de valor diferente do extrato é recusada';
  END;

  /* ------------------------------------------ sentido tem que bater */

  BEGIN
    PERFORM public.conciliar_movimento_ofx(
      v_mov_duplicado, 'LIQUIDAR', v_titulo_parcial, NULL, 'PIX',
      NULL, NULL, NULL, NULL, NULL);
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 13: um débito baixou uma conta a receber';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 13: débito não liquida conta a receber';
  END;

  /* --------------------------------------- reimportar o mesmo arquivo */

  BEGIN
    PERFORM public.registrar_importacao_ofx(
      v_banco, 'EXTRATO TESTE.OFX', v_hash,
      '{}'::jsonb,
      jsonb_build_array(jsonb_build_object('sequencia',1,'dataPostagem', v_dia::text,
        'valorCentavos', -411800, 'fingerprint','fp-vincular-' || v_hash)),
      NULL);
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 14: o mesmo arquivo foi importado duas vezes';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 14: arquivo repetido é recusado (%)', SQLERRM;
  END;

  /* ------------------------------- outro arquivo, período sobreposto */

  v_registro := public.registrar_importacao_ofx(
    v_banco, 'EXTRATO SETEMBRO.OFX', v_hash2,
    jsonb_build_object('moeda','BRL'),
    jsonb_build_array(
      -- Esta já entrou pelo arquivo anterior: mesmo fingerprint.
      jsonb_build_object('sequencia',1,'dataPostagem', v_dia::text,
        'valorCentavos', -411800, 'fingerprint','fp-vincular-' || v_hash),
      jsonb_build_object('sequencia',2,'dataPostagem', v_dia::text,
        'valorCentavos', -7700, 'memo','NOVA DESPESA',
        'fingerprint','fp-nova-' || v_hash2)
    ),
    NULL
  );

  IF (v_registro->>'quantidade_importados')::int = 1
     AND (v_registro->>'quantidade_repetidos')::int = 1 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 15: período sobreposto trouxe só o movimento novo';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 15: importados=%, repetidos=%',
      v_registro->>'quantidade_importados', v_registro->>'quantidade_repetidos';
  END IF;

  SELECT count(*) INTO v_n FROM public.ofx_movimento
   WHERE banco_id = v_banco AND fingerprint = 'fp-vincular-' || v_hash;
  IF v_n = 1 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 16: o movimento repetido continua existindo uma vez só';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 16: o mesmo movimento existe % vezes', v_n;
  END IF;

  RAISE NOTICE '---';
  RAISE NOTICE '=== % passaram, % falharam ===', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Ha % verificacoes falhando.', v_falhou;
  END IF;
END $t$;

ROLLBACK;
