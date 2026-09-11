-- Teste da RPC public.reparcelar_transacao (20260910170000) contra um banco real.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/reparcelar_transacao_vinculado.sql
--
-- O arquivo irmão, `reparcelar_transacao_avulsa.sql`, cobre o que a casca antiga
-- garante. Aqui ficam as regras que nasceram com os dois modos:
--
--   AVULSO      o total pode mudar — era justamente o que a trava impedia
--   VINCULADO   o total não muda, mas a quantidade e as datas mudam
--   e os vínculos que continuam sem reparcelamento nenhum
--
-- Tudo dentro de uma transação que termina em ROLLBACK: nada é escrito.

BEGIN;

DO $$
DECLARE
  v_grupo      bigint;
  v_p1         bigint;
  v_p2         bigint;
  v_os         bigint;
  v_os_fechada bigint;
  v_tx         bigint;
  v_avista     bigint;
  v_soma       numeric;
  v_qtd        int;
  v_texto      text;
  v_cols       text;
  v_ok         int := 0;
  v_falhou     int := 0;
  v_pulados    int := 0;
BEGIN
  /* ---------------- pré-requisitos ---------------- */

  IF to_regprocedure('public.reparcelar_transacao(bigint,jsonb,uuid,text,numeric)') IS NULL THEN
    RAISE EXCEPTION 'A função reparcelar_transacao não existe. Rode as migrations primeiro.';
  END IF;

  /* ---------------- molde ----------------
   *
   * Mesmo desenho do teste irmão: as linhas são clonadas de uma transação real,
   * então o script não precisa conhecer o schema. Coluna gerada sai do molde,
   * senão o INSERT morre com "cannot insert a non-DEFAULT value".
   */
  CREATE TEMP TABLE _molde ON COMMIT DROP AS
    SELECT * FROM public.transacao
     WHERE is_deleted = false AND upper(tipo::text) = 'RECEITA'
     LIMIT 1;

  IF (SELECT count(*) FROM _molde) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma transação de RECEITA para servir de molde.';
  END IF;

  FOR v_texto IN
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
    EXECUTE format('ALTER TABLE _molde DROP COLUMN %I', v_texto);
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
    banco_id = NULL, valor_acrescimos = 0, valor_descontos = 0,
    valor_baixado = 0, is_deleted = false, pendente = true;

  /* ================= AVULSO: o total é livre ================= */

  INSERT INTO public.transacao_parcelamento (descricao)
  VALUES ('TESTE DOIS MODOS AVULSO') RETURNING id INTO v_grupo;

  UPDATE _molde SET parcelamento_id = v_grupo;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE DOIS MODOS AVULSO - Parcela 1/2', valor = 100.00,
    "valorLiquido" = 100.00, data = now() + interval '30 days';
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_p1;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE DOIS MODOS AVULSO - Parcela 2/2', valor = 100.00,
    "valorLiquido" = 100.00, data = now() + interval '60 days';
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_p2;

  RAISE NOTICE 'Fixtures avulso: grupo % / parcelas %, %', v_grupo, v_p1, v_p2;
  RAISE NOTICE '---';

  /* ---------------- 1. avulso: total MENOR é aceito ----------------
   *
   * É o caso do pedido: 2 de 100,00 viram 1 de 150,00. Antes o botão nunca
   * destravava, porque a soma tinha que continuar 200,00.
   */
  BEGIN
    PERFORM public.reparcelar_transacao(v_p1, jsonb_build_array(
      jsonb_build_object('valor', 150.00, 'data', now() + interval '30 days')
    ));

    SELECT count(*), coalesce(sum(valor), 0) INTO v_qtd, v_soma
      FROM public.transacao
     WHERE parcelamento_id = v_grupo AND is_deleted = false AND pendente = true;

    IF v_qtd = 1 AND v_soma = 150.00 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 1: total avulso caiu para % em % parcela', v_soma, v_qtd;
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 1: % parcelas somando % (esperava 1 somando 150.00)', v_qtd, v_soma;
    END IF;

    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN NULL;
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 1: total menor recusado -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 2. avulso: total MAIOR é aceito ----------------
   *
   * Renegociação com juros: a dívida cresce e passa a caber em três vezes.
   */
  BEGIN
    PERFORM public.reparcelar_transacao(v_p1, jsonb_build_array(
      jsonb_build_object('valor', 100.00, 'data', now() + interval '30 days'),
      jsonb_build_object('valor', 100.00, 'data', now() + interval '60 days'),
      jsonb_build_object('valor', 100.00, 'data', now() + interval '90 days')
    ));

    SELECT count(*), coalesce(sum(valor), 0) INTO v_qtd, v_soma
      FROM public.transacao
     WHERE parcelamento_id = v_grupo AND is_deleted = false AND pendente = true;

    IF v_qtd = 3 AND v_soma = 300.00 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 2: total avulso subiu para % em % parcelas', v_soma, v_qtd;
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 2: % parcelas somando % (esperava 3 somando 300.00)', v_qtd, v_soma;
    END IF;

    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN NULL;
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 2: total maior recusado -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 3. avulso: a mudança de valor vai para o histórico ----------------
   *
   * O motivo continua opcional; sem ele o histórico grava 'Reparcelamento'. É a
   * trilha que responde depois por que a dívida encolheu.
   */
  BEGIN
    PERFORM public.reparcelar_transacao(v_p1, jsonb_build_array(
      jsonb_build_object('valor', 150.00, 'data', now() + interval '30 days')
    ));

    SELECT count(*) INTO v_qtd
      FROM public.transacao_valor_historico
     WHERE transacao_id = v_p1 AND motivo = 'Reparcelamento';

    IF v_qtd >= 1 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 3: histórico registrou a mudança de valor';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 3: nada no histórico da transação %', v_p1;
    END IF;

    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN NULL;
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 3: -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 4. total anterior divergente ----------------
   *
   * Sem a trava da soma, é esta guarda que impede duas telas de salvarem uma por
   * cima da outra. O grupo tem 200,00 em aberto; a tela diz que viu 999,00.
   */
  BEGIN
    PERFORM public.reparcelar_transacao(v_p1, jsonb_build_array(
      jsonb_build_object('valor', 150.00, 'data', now() + interval '30 days')
    ), NULL, NULL, 999.00);
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: total anterior divergente foi aceito';
  EXCEPTION WHEN sqlstate '40001' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: total anterior divergente recusado -> %', SQLERRM;
  END;

  /* ---------------- 5. baixa parcial no grupo ----------------
   *
   * Título com baixa parcial continua pendente, mas tem transações filhas
   * apontando para ele. Reparcelar podia baixar o valor abaixo do que já entrou.
   */
  BEGIN
    UPDATE public.transacao SET valor_baixado = 30.00 WHERE id = v_p2;

    BEGIN
      PERFORM public.reparcelar_transacao(v_p1, jsonb_build_array(
        jsonb_build_object('valor', 200.00, 'data', now() + interval '30 days')
      ));
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 5: grupo com baixa parcial foi reparcelado';
    EXCEPTION WHEN sqlstate '22023' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 5: baixa parcial recusada -> %', SQLERRM;
    END;

    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN NULL;
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 5: -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 6. os vínculos que continuam de fora ----------------
   *
   * Um caso por motivo. Todos recusam com 22023 e mensagem própria: o usuário
   * precisa saber qual caminho usar, não só que este não serve.
   */
  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE DOIS MODOS ANTECIPADO', valor = 50.00, "valorLiquido" = 50.00,
    data = now() + interval '30 days', parcelamento_id = v_grupo, eh_adiantamento = true;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_tx;
  UPDATE _molde SET eh_adiantamento = false;

  BEGIN
    PERFORM public.reparcelar_transacao(v_tx, jsonb_build_array(
      jsonb_build_object('valor', 50.00, 'data', now() + interval '30 days')
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 6: título antecipado foi reparcelado';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 6: título antecipado recusado -> %', SQLERRM;
  END;

  /* ---------------- 7. sem grupo e sem documento ---------------- */
  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE DOIS MODOS SOLTO', valor = 50.00, "valorLiquido" = 50.00,
    data = now() + interval '30 days', parcelamento_id = NULL;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_tx;
  UPDATE _molde SET parcelamento_id = v_grupo;

  BEGIN
    PERFORM public.reparcelar_transacao(v_tx, jsonb_build_array(
      jsonb_build_object('valor', 50.00, 'data', now() + interval '30 days')
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 7: transação sem grupo foi reparcelada';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 7: transação sem grupo recusada -> %', SQLERRM;
  END;

  /* ================= VINCULADO: OS ================= */

  /* ---------------- 8. OS ENCERRADA aceita parcela nova ----------------
   *
   * É a decisão que motivou a dispensa do gate de status em
   * `validar_novo_recebimento_os`: a OS entregue com parcelas em aberto é o caso
   * mais comum de renegociação, e redividir o que já está lançado não é
   * recebimento novo — o total é o mesmo antes e depois.
   *
   * Precisa de uma OS FORA dos status que aceitam pagamento e sem outra
   * pendente, para o grupo do documento ser só o que este teste criou.
   */
  SELECT o.id INTO v_os_fechada
    FROM public.ordemservico o
   WHERE coalesce(o.is_deleted, false) = false
     AND o.status NOT IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO', 'FATURAMENTO')
     AND NOT EXISTS (
       SELECT 1 FROM public.transacao t
        WHERE t.ordemservicoid = o.id AND t.is_deleted = false AND t.pendente = true
          AND upper(t.tipo::text) = 'RECEITA' AND t.evento_financeiro_id IS NULL
     )
   LIMIT 1;

  IF v_os_fechada IS NULL THEN
    v_pulados := v_pulados + 1;
    RAISE NOTICE 'PULADO 8: nenhuma OS encerrada e sem pendente neste banco';
  ELSE
    BEGIN
      -- O título nasce direto no banco, sem passar pela RPC: o gate de status
      -- não se aplica a UPDATE, e é o INSERT do reparcelamento que precisa
      -- passar por ele. Aqui é fixture.
      PERFORM set_config('app.reparcelamento_em_curso', 'permitido', true);
      UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
        descricao = 'TESTE OS ENCERRADA - Parcela 1/1', valor = 90.00,
        "valorLiquido" = 90.00, data = now() + interval '30 days',
        parcelamento_id = NULL, ordemservicoid = v_os_fechada;
      EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
        INTO v_tx;
      PERFORM set_config('app.reparcelamento_em_curso', '', true);

      PERFORM public.reparcelar_transacao(v_tx, jsonb_build_array(
        jsonb_build_object('valor', 30.00, 'data', now() + interval '30 days'),
        jsonb_build_object('valor', 30.00, 'data', now() + interval '60 days'),
        jsonb_build_object('valor', 30.00, 'data', now() + interval '90 days')
      ));

      SELECT count(*), coalesce(sum(valor), 0) INTO v_qtd, v_soma
        FROM public.transacao
       WHERE ordemservicoid = v_os_fechada AND is_deleted = false AND pendente = true
         AND upper(tipo::text) = 'RECEITA' AND evento_financeiro_id IS NULL;

      IF v_qtd = 3 AND v_soma = 90.00 THEN
        v_ok := v_ok + 1;
        RAISE NOTICE 'OK 8: OS encerrada foi de 1x para 3x mantendo %', v_soma;
      ELSE
        v_falhou := v_falhou + 1;
        RAISE NOTICE 'FALHOU 8: % parcelas somando % (esperava 3 somando 90.00)', v_qtd, v_soma;
      END IF;

      RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
    EXCEPTION
      WHEN sqlstate 'P0001' THEN NULL;
      WHEN OTHERS THEN
        v_falhou := v_falhou + 1;
        RAISE NOTICE 'FALHOU 8: OS encerrada recusou o reparcelamento -> % (%)', SQLERRM, SQLSTATE;
    END;
  END IF;

  /* ---------------- 9. as parcelas novas não herdam o que não podem ----------------
   *
   * `banco_id` é o principal: título que nasce pendente não tem onde o dinheiro
   * caiu, e a versão anterior da função herdava do template.
   */
  SELECT o.id INTO v_os
    FROM public.ordemservico o
   WHERE coalesce(o.is_deleted, false) = false
     AND o.status IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO')
     AND NOT EXISTS (
       SELECT 1 FROM public.transacao t
        WHERE t.ordemservicoid = o.id AND t.is_deleted = false AND t.pendente = true
          AND upper(t.tipo::text) = 'RECEITA' AND t.evento_financeiro_id IS NULL
     )
   LIMIT 1;

  IF v_os IS NULL THEN
    v_pulados := v_pulados + 1;
    RAISE NOTICE 'PULADO 9 e 10: nenhuma OS aberta e sem pendente neste banco';
  ELSE
    BEGIN
      -- Uma entrada à vista, que NÃO pode ser tocada pela renumeração.
      UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
        descricao = 'TESTE OS ABERTA ENTRADA', valor = 10.00, "valorLiquido" = 10.00,
        data = now() - interval '5 days', pendente = false,
        parcelamento_id = NULL, ordemservicoid = v_os;
      EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
        INTO v_avista;

      UPDATE _molde SET pendente = true;
      UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
        descricao = 'TESTE OS ABERTA SERVICO - Parcela 1/1', valor = 60.00,
        "valorLiquido" = 60.00, data = now() + interval '30 days';
      EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
        INTO v_tx;

      PERFORM public.reparcelar_transacao(v_tx, jsonb_build_array(
        jsonb_build_object('valor', 20.00, 'data', now() + interval '30 days'),
        jsonb_build_object('valor', 20.00, 'data', now() + interval '60 days'),
        jsonb_build_object('valor', 20.00, 'data', now() + interval '90 days')
      ));

      SELECT count(*) INTO v_qtd
        FROM public.transacao
       WHERE ordemservicoid = v_os AND is_deleted = false AND pendente = true
         AND upper(tipo::text) = 'RECEITA' AND evento_financeiro_id IS NULL
         AND (banco_id IS NOT NULL
           OR evento_financeiro_id IS NOT NULL
           OR pagamento_multiplo_id IS NOT NULL
           OR adiantamento_id IS NOT NULL
           OR coalesce(valor_baixado, 0) <> 0);

      IF v_qtd = 0 THEN
        v_ok := v_ok + 1;
        RAISE NOTICE 'OK 9: nenhuma parcela nova herdou banco, evento, rateio ou baixa';
      ELSE
        v_falhou := v_falhou + 1;
        RAISE NOTICE 'FALHOU 9: % parcela(s) herdaram o que não podiam', v_qtd;
      END IF;

      /* ---------------- 10. a renumeração não invade o resto da OS ---------------- */
      SELECT descricao INTO v_texto FROM public.transacao WHERE id = v_avista;

      IF v_texto = 'TESTE OS ABERTA ENTRADA' THEN
        v_ok := v_ok + 1;
        RAISE NOTICE 'OK 10: a entrada à vista manteve a descrição intacta';
      ELSE
        v_falhou := v_falhou + 1;
        RAISE NOTICE 'FALHOU 10: a entrada à vista virou "%"', v_texto;
      END IF;

      RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
    EXCEPTION
      WHEN sqlstate 'P0001' THEN NULL;
      WHEN OTHERS THEN
        v_falhou := v_falhou + 1;
        RAISE NOTICE 'FALHOU 9/10: -> % (%)', SQLERRM, SQLSTATE;
    END;
  END IF;

  /* ---------------- resultado ---------------- */
  RAISE NOTICE '---';
  RAISE NOTICE 'OK: % | FALHOU: % | PULADOS: %', v_ok, v_falhou, v_pulados;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION '% caso(s) falharam.', v_falhou;
  END IF;
END $$;

ROLLBACK;
