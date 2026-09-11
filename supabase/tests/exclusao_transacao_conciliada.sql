-- Recusas do BANCO ao excluir uma transação, e o caminho de saída de cada uma.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/exclusao_transacao_conciliada.sql
--
-- Duas constraints impedem exclusões legítimas, e as duas chegavam ao usuário
-- como 500 "Erro ao deletar transação." — que diz que o sistema quebrou, quando
-- o banco está protegendo um vínculo que existe. `traduzirErroExclusao`
-- (src/app/api/transaction/_lib/erros-exclusao.ts) passou a devolver 409 com o
-- caminho. Este teste prova que as recusas são reais e que o caminho funciona.
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito.

BEGIN;

DO $$
DECLARE
  v_col_gerada text;
  v_cols       text;
  v_banco      bigint;
  v_importacao bigint;
  v_movimento  bigint;
  v_tx         bigint;
  v_estorno    bigint;
  v_ok         int := 0;
  v_falhou     int := 0;
BEGIN
  /* ---------------- pré-requisitos ---------------- */

  IF to_regclass('public.ofx_movimento') IS NULL THEN
    RAISE EXCEPTION 'A tabela ofx_movimento não existe. Rode as migrations primeiro.';
  END IF;

  SELECT id INTO v_banco FROM public.bancoconta ORDER BY id LIMIT 1;
  IF v_banco IS NULL THEN
    RAISE EXCEPTION 'Nenhuma conta bancária para servir de fixture.';
  END IF;

  /* ---------------- molde ---------------- */

  CREATE TEMP TABLE _molde ON COMMIT DROP AS
    SELECT * FROM public.transacao
     WHERE is_deleted = false AND upper(tipo::text) = 'RECEITA'
     LIMIT 1;

  IF (SELECT count(*) FROM _molde) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma transação de RECEITA para servir de molde.';
  END IF;

  -- Coluna gerada não se insere. Mesmo remédio dos testes vizinhos.
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

  UPDATE _molde SET
    ordemservicoid = NULL, vendaid = NULL, entrada_id = NULL,
    usoconsumo_entrada_id = NULL, evento_financeiro_id = NULL,
    estorno_transacao_id = NULL, pagamento_multiplo_id = NULL,
    adiantamento_id = NULL, eh_adiantamento = false, transferencia_id = NULL,
    parcelamento_id = NULL, baixa_de_transacao_id = NULL,
    valor_acrescimos = 0, valor_descontos = 0, valor_baixado = 0,
    is_deleted = false, pendente = true, banco_id = NULL,
    descricao = 'TESTE RECUSA DE EXCLUSAO', valor = 123.45, "valorLiquido" = 123.45,
    data = now();

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id'));
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_tx;

  /* ---------------- 1. transação conciliada com o extrato ---------------- */

  INSERT INTO public.ofx_importacao (banco_id, arquivo_nome, arquivo_hash)
  VALUES (v_banco, 'TESTE.ofx', 'hash-de-teste-' || v_tx)
  RETURNING id INTO v_importacao;

  INSERT INTO public.ofx_movimento (
    importacao_id, banco_id, sequencia, fingerprint,
    data_postagem, valor, valor_centavos,
    status, transacao_id
  ) VALUES (
    v_importacao, v_banco, 1, 'fingerprint-de-teste-' || v_tx,
    current_date, 123.45, 12345,
    'CONCILIADO', v_tx
  )
  RETURNING id INTO v_movimento;

  BEGIN
    DELETE FROM public.transacao WHERE id = v_tx;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: transação conciliada foi excluída sem reclamar';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: conciliada recusada (%) -> %', SQLSTATE, SQLERRM;
  END;

  /* ---------------- 2. desfeita a conciliação, a exclusão passa ----------------
   *
   * É o caminho que a mensagem nova manda seguir. Sem este caso, a mensagem
   * poderia estar mandando o usuário para uma porta que não abre.
   */
  BEGIN
    UPDATE public.ofx_movimento
       SET status = 'PENDENTE', transacao_id = NULL, conciliado_em = NULL
     WHERE id = v_movimento;

    DELETE FROM public.transacao WHERE id = v_tx;

    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: desfeita a conciliação, a transação saiu';

    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN NULL;
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 2: mesmo desconciliada a exclusão foi recusada -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 3. transação com estorno apontando para ela ----------------
   *
   * `transacao.estorno_transacao_id` referencia `transacao(id)` com RESTRICT:
   * quem sai primeiro é o estorno.
   */
  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE RECUSA - estorno', estorno_transacao_id = v_tx;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_estorno;
  UPDATE _molde SET estorno_transacao_id = NULL;

  BEGIN
    -- A conciliação ainda está de pé aqui, então tiramos ela do caminho para o
    -- teste medir a FK do estorno, e não o CHECK do OFX de novo.
    UPDATE public.ofx_movimento
       SET status = 'PENDENTE', transacao_id = NULL, conciliado_em = NULL
     WHERE id = v_movimento;

    DELETE FROM public.transacao WHERE id = v_tx;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: original com estorno apontando foi excluída';
  EXCEPTION WHEN foreign_key_violation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: original com estorno recusada (%) -> %', SQLSTATE, SQLERRM;
  END;

  /* ---------------- 4. excluído o estorno, o original sai ---------------- */
  BEGIN
    UPDATE public.ofx_movimento
       SET status = 'PENDENTE', transacao_id = NULL, conciliado_em = NULL
     WHERE id = v_movimento;

    DELETE FROM public.transacao WHERE id = v_estorno;
    DELETE FROM public.transacao WHERE id = v_tx;

    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: excluído o estorno, o original saiu';

    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN NULL;
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 4: -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- resultado ---------------- */
  RAISE NOTICE '---';
  RAISE NOTICE 'OK: % | FALHOU: %', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION '% caso(s) falharam.', v_falhou;
  END IF;
END $$;

ROLLBACK;
