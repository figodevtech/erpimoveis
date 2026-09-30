-- Excluir transação conciliada com o extrato desfaz a conciliação.
--
-- Como rodar (banco com a migration 20260930150000 aplicada):
--   npm run db:test:sql -- supabase/tests/exclusao_transacao_conciliada.sql
-- Antes do deploy, `npm run db:test:exclusao-desconcilia` aplica as migrations
-- pendentes e roda este mesmo arquivo, tudo revertido.
--
-- Antes, `ofx_movimento.transacao_id` ON DELETE SET NULL batia no CHECK
-- `ofx_movimento_conciliado_tem_transacao_check` e o banco recusava a exclusão.
-- Agora `trg_desconciliar_transacao_excluida` devolve o movimento para PENDENTE
-- no mesmo comando. Este teste prova:
--   1. exclusão física passa e o movimento volta a pendente, limpo;
--   2. exclusão lógica (`is_deleted`) também desconcilia;
--   3. a filha de baixa parcial, levada pelo CASCADE do título, desconcilia;
--   4. se a exclusão for recusada por outro motivo (estorno apontando), a
--      conciliação fica de pé — as duas coisas são um comando só.
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito.

BEGIN;

DO $$
DECLARE
  v_col_gerada text;
  v_cols       text;
  v_banco      bigint;
  v_importacao bigint;
  v_seq        int := 0;
  v_movimento  bigint;
  v_tx         bigint;
  v_filha      bigint;
  v_estorno    bigint;
  v_mov        record;
  v_ok         int := 0;
  v_falhou     int := 0;
BEGIN
  /* ---------------- pré-requisitos ---------------- */

  IF to_regclass('public.ofx_movimento') IS NULL THEN
    RAISE EXCEPTION 'A tabela ofx_movimento não existe. Rode as migrations primeiro.';
  END IF;

  IF to_regprocedure('public.fn_desconciliar_transacao_excluida()') IS NULL THEN
    RAISE EXCEPTION 'fn_desconciliar_transacao_excluida() não existe. Aplique a migration 20260930150000.';
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
    descricao = 'TESTE EXCLUSAO DESCONCILIA', valor = 123.45, "valorLiquido" = 123.45,
    data = now();

  INSERT INTO public.ofx_importacao (banco_id, arquivo_nome, arquivo_hash)
  VALUES (v_banco, 'TESTE.ofx', 'hash-de-teste-desconcilia-' || txid_current())
  RETURNING id INTO v_importacao;

  /* ---------------- 1. exclusão física desconcilia ---------------- */

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id'));
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_tx;

  v_seq := v_seq + 1;
  INSERT INTO public.ofx_movimento (
    importacao_id, banco_id, sequencia, fingerprint, data_postagem, valor, valor_centavos,
    status, acao_conciliacao, transacao_id, conciliado_em
  ) VALUES (
    v_importacao, v_banco, v_seq, 'fp-desconcilia-' || v_tx, current_date, 123.45, 12345,
    'CONCILIADO', 'VINCULAR', v_tx, now()
  ) RETURNING id INTO v_movimento;

  BEGIN
    DELETE FROM public.transacao WHERE id = v_tx;
    SELECT status, acao_conciliacao, transacao_id, conciliado_em INTO v_mov
      FROM public.ofx_movimento WHERE id = v_movimento;

    IF v_mov.status = 'PENDENTE' AND v_mov.transacao_id IS NULL
       AND v_mov.acao_conciliacao IS NULL AND v_mov.conciliado_em IS NULL THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 1: excluída, e o movimento voltou a pendente';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 1: excluída, mas o movimento ficou % / %', v_mov.status, v_mov.acao_conciliacao;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: exclusão recusada -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 2. exclusão lógica desconcilia ---------------- */

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id'));
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_tx;

  v_seq := v_seq + 1;
  INSERT INTO public.ofx_movimento (
    importacao_id, banco_id, sequencia, fingerprint, data_postagem, valor, valor_centavos,
    status, acao_conciliacao, transacao_id, conciliado_em
  ) VALUES (
    v_importacao, v_banco, v_seq, 'fp-desconcilia-' || v_tx, current_date, 123.45, 12345,
    'CONCILIADO', 'VINCULAR', v_tx, now()
  ) RETURNING id INTO v_movimento;

  BEGIN
    UPDATE public.transacao SET is_deleted = true WHERE id = v_tx;
    SELECT status, transacao_id INTO v_mov FROM public.ofx_movimento WHERE id = v_movimento;

    IF v_mov.status = 'PENDENTE' AND v_mov.transacao_id IS NULL THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 2: excluída logicamente, e o movimento voltou a pendente';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 2: is_deleted = true, mas o movimento ficou %', v_mov.status;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 2: -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 3. filha de baixa parcial, levada pelo CASCADE ---------------- */

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE EXCLUSAO DESCONCILIA - título', valor = 100, "valorLiquido" = 100;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_tx;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE EXCLUSAO DESCONCILIA - baixa parcial', valor = 40, "valorLiquido" = 40,
    pendente = false, banco_id = v_banco, baixa_de_transacao_id = v_tx;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_filha;
  UPDATE _molde SET pendente = true, banco_id = NULL, baixa_de_transacao_id = NULL,
    valor = 123.45, "valorLiquido" = 123.45, descricao = 'TESTE EXCLUSAO DESCONCILIA';

  v_seq := v_seq + 1;
  INSERT INTO public.ofx_movimento (
    importacao_id, banco_id, sequencia, fingerprint, data_postagem, valor, valor_centavos,
    status, acao_conciliacao, transacao_id, titulo_origem_id, conciliado_em
  ) VALUES (
    v_importacao, v_banco, v_seq, 'fp-desconcilia-' || v_filha, current_date, 40, 4000,
    'CONCILIADO', 'BAIXA_PARCIAL', v_filha, v_tx, now()
  ) RETURNING id INTO v_movimento;

  BEGIN
    DELETE FROM public.transacao WHERE id = v_tx;
    SELECT status, transacao_id, titulo_origem_id INTO v_mov
      FROM public.ofx_movimento WHERE id = v_movimento;

    IF NOT EXISTS (SELECT 1 FROM public.transacao WHERE id = v_filha)
       AND v_mov.status = 'PENDENTE' AND v_mov.transacao_id IS NULL AND v_mov.titulo_origem_id IS NULL THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 3: título excluído, a baixa parcial foi junto e o movimento dela voltou a pendente';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 3: movimento da baixa parcial ficou %', v_mov.status;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 4. recusa por outro motivo mantém a conciliação ----------------
   *
   * `transacao.estorno_transacao_id` é RESTRICT: com o estorno apontando, a
   * exclusão falha. A desconciliação estava no mesmo comando e precisa voltar
   * junto — senão o movimento ficaria pendente com a transação ainda viva.
   */
  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id'));
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_tx;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE EXCLUSAO DESCONCILIA - estorno', estorno_transacao_id = v_tx;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_estorno;
  UPDATE _molde SET estorno_transacao_id = NULL, descricao = 'TESTE EXCLUSAO DESCONCILIA';

  v_seq := v_seq + 1;
  INSERT INTO public.ofx_movimento (
    importacao_id, banco_id, sequencia, fingerprint, data_postagem, valor, valor_centavos,
    status, acao_conciliacao, transacao_id, conciliado_em
  ) VALUES (
    v_importacao, v_banco, v_seq, 'fp-desconcilia-' || v_tx, current_date, 123.45, 12345,
    'CONCILIADO', 'VINCULAR', v_tx, now()
  ) RETURNING id INTO v_movimento;

  BEGIN
    DELETE FROM public.transacao WHERE id = v_tx;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: original com estorno apontando foi excluída';
  EXCEPTION WHEN foreign_key_violation THEN
    SELECT status, transacao_id INTO v_mov FROM public.ofx_movimento WHERE id = v_movimento;
    IF v_mov.status = 'CONCILIADO' AND v_mov.transacao_id = v_tx THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 4: exclusão recusada pelo estorno, e a conciliação ficou de pé';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 4: exclusão recusada, mas o movimento ficou %', v_mov.status;
    END IF;
  END;

  /* ---------------- 5. nada conciliado com transação excluída ---------------- */
  IF EXISTS (
    SELECT 1 FROM public.ofx_movimento m
      JOIN public.transacao t ON t.id = m.transacao_id
     WHERE m.status = 'CONCILIADO' AND t.is_deleted IS TRUE
  ) THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 5: ainda há movimento conciliado com transação excluída logicamente';
  ELSE
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 5: nenhum movimento conciliado com transação excluída';
  END IF;

  /* ---------------- resultado ---------------- */
  RAISE NOTICE '---';
  RAISE NOTICE 'OK: % | FALHOU: %', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION '% caso(s) falharam.', v_falhou;
  END IF;
END $$;

ROLLBACK;
