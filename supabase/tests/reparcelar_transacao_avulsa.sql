-- Teste da RPC public.reparcelar_transacao_avulsa contra um banco real (demo).
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/reparcelar_transacao_avulsa.sql
--
-- Tudo acontece dentro de uma transação que termina em ROLLBACK: as parcelas de
-- teste, o grupo e o histórico somem no fim. Nada é escrito no banco.
--
-- As linhas de teste são clonadas de uma transação existente (via tabela
-- temporária `_molde`), então o script não precisa conhecer o schema — se um dia
-- a tabela ganhar uma coluna NOT NULL, ele continua funcionando.

BEGIN;

DO $$
DECLARE
  v_grupo     bigint;
  v_vinculado bigint;
  v_com_ajuste bigint;
  v_p1        bigint;
  v_p2        bigint;
  v_p3        bigint;
  v_baixada   bigint;
  v_os        bigint;
  v_entrada   bigint;
  v_de_entrada bigint;
  v_com_entrada int;
  v_soma      numeric;
  v_qtd       int;
  v_texto     text;
  v_cols      text;
  v_ok        int := 0;
  v_falhou    int := 0;
BEGIN
  /* ---------------- pré-requisitos ---------------- */

  IF to_regprocedure('public.reparcelar_transacao_avulsa(bigint,jsonb,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'A função reparcelar_transacao_avulsa não existe. Rode as migrations primeiro.';
  END IF;

  IF to_regclass('public.transacao_parcelamento') IS NULL THEN
    RAISE EXCEPTION 'A tabela transacao_parcelamento não existe. Rode as migrations primeiro.';
  END IF;

  /* ---------------- fixtures ---------------- */

  INSERT INTO public.transacao_parcelamento (descricao)
  VALUES ('TESTE REPARCELAR')
  RETURNING id INTO v_grupo;

  CREATE TEMP TABLE _molde ON COMMIT DROP AS
    SELECT * FROM public.transacao
     WHERE is_deleted = false AND upper(tipo::text) = 'RECEITA'
     LIMIT 1;

  IF (SELECT count(*) FROM _molde) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma transação de RECEITA para servir de molde.';
  END IF;

  /*
   * Coluna gerada não se insere: `data_dia` (20260901220000) veio depois deste
   * teste e passou a entrar no `SELECT *` do molde, quebrando todos os inserts
   * com "cannot insert a non-DEFAULT value". Some do molde e a lista de colunas
   * passa a ser explícita — o script continua sem conhecer o schema, e uma
   * coluna gerada nova amanhã também não o quebra.
   */
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

  -- Zera o que não deve vazar do molde: o grupo tem que nascer avulso e pendente.
  UPDATE _molde SET
    ordemservicoid = NULL, vendaid = NULL, entrada_id = NULL,
    usoconsumo_entrada_id = NULL, evento_financeiro_id = NULL,
    estorno_transacao_id = NULL, pagamento_multiplo_id = NULL,
    adiantamento_id = NULL, eh_adiantamento = false,
    valor_acrescimos = 0, valor_descontos = 0,
    is_deleted = false, pendente = true, parcelamento_id = v_grupo;

  -- Uma parcela já baixada: entra na numeração e nunca no reparcelamento.
  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE REPARCELAR - Parcela 1/3', valor = 100.00, "valorLiquido" = 100.00,
    data = now() - interval '30 days', pendente = false;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_baixada;

  UPDATE _molde SET pendente = true;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE REPARCELAR - Parcela 2/3', valor = 100.00, "valorLiquido" = 100.00,
    data = now() + interval '30 days';
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_p1;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE REPARCELAR - Parcela 3/3', valor = 100.01, "valorLiquido" = 100.01,
    data = now() + interval '60 days';
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_p2;

  RAISE NOTICE 'Fixtures: grupo % / baixada % / pendentes %, %', v_grupo, v_baixada, v_p1, v_p2;
  RAISE NOTICE '---';

  /* ---------------- 1. soma diferente ---------------- */
  BEGIN
    PERFORM public.reparcelar_transacao_avulsa(v_grupo, jsonb_build_array(
      jsonb_build_object('valor', 100.00, 'data', now() + interval '30 days'),
      jsonb_build_object('valor', 100.00, 'data', now() + interval '60 days')
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: soma diferente foi aceita';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: soma diferente recusada -> %', SQLERRM;
  END;

  /* ---------------- 2. vencimento no passado é aceito ----------------
   *
   * Reparcelar é o que se faz com título vencido: exigir data futura impedia
   * até manter a data da parcela que venceu. Como este caminho é o feliz, ele
   * grava — e o RAISE logo depois desfaz a subtransação para os testes
   * seguintes continuarem partindo do mesmo estado.
   */
  BEGIN
    PERFORM public.reparcelar_transacao_avulsa(v_grupo, jsonb_build_array(
      jsonb_build_object('valor', 200.01, 'data', now() - interval '1 day')
    ));
    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 2: vencimento no passado aceito';
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 2: vencimento no passado recusado -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 3. parcela zerada (soma fecha mesmo assim) ---------------- */
  BEGIN
    PERFORM public.reparcelar_transacao_avulsa(v_grupo, jsonb_build_array(
      jsonb_build_object('valor', 200.01, 'data', now() + interval '30 days'),
      jsonb_build_object('valor', 0, 'data', now() + interval '60 days')
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: parcela zerada foi aceita';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: parcela zerada recusada -> %', SQLERRM;
  END;

  /* ---------------- 4. grupo inexistente ---------------- */
  BEGIN
    PERFORM public.reparcelar_transacao_avulsa(2147483000, jsonb_build_array(
      jsonb_build_object('valor', 10.00, 'data', now() + interval '30 days')
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: grupo inexistente foi aceito';
  EXCEPTION WHEN sqlstate 'P0002' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: grupo inexistente recusado';
  END;

  /* ---------------- 5. reparcelamento válido: 2 pendentes viram 3 ---------------- */
  BEGIN
    PERFORM public.reparcelar_transacao_avulsa(
      v_grupo,
      jsonb_build_array(
        jsonb_build_object('valor', 66.67, 'data', now() + interval '30 days'),
        jsonb_build_object('valor', 66.67, 'data', now() + interval '60 days'),
        jsonb_build_object('valor', 66.67, 'data', now() + interval '90 days')
      ),
      NULL,
      'cliente pediu mais uma vez'
    );

    SELECT round(sum(valor), 2), count(*) INTO v_soma, v_qtd
      FROM public.transacao
     WHERE parcelamento_id = v_grupo AND is_deleted = false AND pendente = true;

    IF v_soma = 200.01 AND v_qtd = 3 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 5: 3 pendentes somando % (o total em aberto foi preservado)', v_soma;
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 5: % pendentes somando % (esperado 3 e 200.01)', v_qtd, v_soma;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 5: reparcelamento válido foi recusado -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 6. a parcela baixada ficou intacta ---------------- */
  SELECT valor INTO v_soma FROM public.transacao WHERE id = v_baixada;

  IF v_soma = 100.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 6: parcela baixada manteve o valor';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 6: parcela baixada virou %', v_soma;
  END IF;

  /* ---------------- 7. a numeração acompanhou o novo total ---------------- */
  SELECT descricao INTO v_texto FROM public.transacao WHERE id = v_baixada;

  IF v_texto = 'TESTE REPARCELAR - Parcela 1/4' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 7: numeração refeita -> %', v_texto;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 7: descrição ficou "%" (esperado 1/4)', v_texto;
  END IF;

  /* ---------------- 8. o histórico registrou a mudança de valor ---------------- */
  SELECT count(*) INTO v_qtd
    FROM public.transacao_valor_historico
   WHERE transacao_id IN (v_p1, v_p2);

  IF v_qtd = 2 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 8: histórico gravou as duas parcelas reaproveitadas';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 8: histórico gravou % linhas (esperado 2)', v_qtd;
  END IF;

  /* ---------------- 9. reduzir a quantidade some com a sobra ---------------- */
  BEGIN
    PERFORM public.reparcelar_transacao_avulsa(v_grupo, jsonb_build_array(
      jsonb_build_object('valor', 200.01, 'data', now() + interval '45 days')
    ));

    SELECT count(*) INTO v_qtd
      FROM public.transacao
     WHERE parcelamento_id = v_grupo AND is_deleted = false AND pendente = true;

    IF v_qtd = 1 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 9: sobrou uma parcela pendente';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 9: sobraram % parcelas pendentes (esperado 1)', v_qtd;
    END IF;

    SELECT count(*) INTO v_qtd
      FROM public.transacao
     WHERE parcelamento_id = v_grupo AND is_deleted = true;

    IF v_qtd = 2 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 10: as duas que sobravam saíram por exclusão lógica';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 10: % linhas marcadas como excluídas (esperado 2)', v_qtd;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 9/10: redução foi recusada -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 11. grupo com vínculo a documento ----------------
   *
   * A OS precisa estar num status que aceite pagamento: `tg_transacao_os_*`
   * (20260809180000) recusa o INSERT fora de ORCAMENTO_APROVADO / EM_ANDAMENTO /
   * PAGAMENTO, e um `LIMIT 1` sem filtro pegava qualquer uma — o teste quebrava
   * no fixture, antes de chegar à regra que ele existe para verificar.
   */
  SELECT o.id INTO v_os
    FROM public.ordemservico o
   WHERE coalesce(o.is_deleted, false) = false
     AND o.status IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO')
   LIMIT 1;

  IF v_os IS NOT NULL THEN
    INSERT INTO public.transacao_parcelamento (descricao)
    VALUES ('TESTE REPARCELAR VINCULADO')
    RETURNING id INTO v_vinculado;

    UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
      descricao = 'TESTE REPARCELAR VINCULADO - Parcela 1/1', valor = 10.00,
      "valorLiquido" = 10.00, data = now() + interval '30 days',
      pendente = true, parcelamento_id = v_vinculado, ordemservicoid = v_os;
    EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde', v_cols, v_cols);

    BEGIN
      PERFORM public.reparcelar_transacao_avulsa(v_vinculado, jsonb_build_array(
        jsonb_build_object('valor', 10.00, 'data', now() + interval '60 days')
      ));
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 11: grupo vinculado a documento foi reparcelado';
    EXCEPTION WHEN sqlstate '22023' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 11: grupo vinculado recusado -> %', SQLERRM;
    END;

    UPDATE _molde SET ordemservicoid = NULL;
  END IF;

  /* ---------------- 12. parcela com acréscimo lançado ---------------- */
  INSERT INTO public.transacao_parcelamento (descricao)
  VALUES ('TESTE REPARCELAR COM AJUSTE')
  RETURNING id INTO v_com_ajuste;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE REPARCELAR COM AJUSTE - Parcela 1/1', valor = 110.00,
    "valorLiquido" = 110.00, data = now() + interval '30 days',
    pendente = true, parcelamento_id = v_com_ajuste, valor_acrescimos = 10.00;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_p3;

  BEGIN
    PERFORM public.reparcelar_transacao_avulsa(v_com_ajuste, jsonb_build_array(
      jsonb_build_object('valor', 55.00, 'data', now() + interval '30 days'),
      jsonb_build_object('valor', 55.00, 'data', now() + interval '60 days')
    ));

    -- A linha de acréscimo não se move: fica na parcela daquela posição, e o
    -- gatilho `transacao_valor_coerente` refaz a face a partir do novo valor.
    SELECT valor_base INTO v_soma FROM public.transacao WHERE id = v_p3;

    IF v_soma = 45.00 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 12: parcela com acréscimo reparcelada, face virou % (55,00 - 10,00)', v_soma;
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 12: face ficou % (esperado 45.00)', v_soma;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 12: parcela com acréscimo foi recusada -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 13. parcela de nota de compra É reparcelável ----------------
   *
   * O contrário do teste 11, e o motivo de 20260903260000 existir: a entrada
   * fiscal saiu da trava de documento porque não tem rateio nem como refazer o
   * lançamento — sem isso, a divisão das parcelas de uma compra era definitiva.
   * O total continua protegido pela regra da soma.
   */
  SELECT e.id INTO v_entrada FROM public.entrada e LIMIT 1;

  IF v_entrada IS NOT NULL THEN
    INSERT INTO public.transacao_parcelamento (descricao)
    VALUES ('TESTE REPARCELAR ENTRADA')
    RETURNING id INTO v_de_entrada;

    UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
      descricao = 'TESTE REPARCELAR ENTRADA - Parcela 1/2', valor = 60.00,
      "valorLiquido" = 60.00, data = now() + interval '30 days', pendente = true,
      parcelamento_id = v_de_entrada, valor_acrescimos = 0, entrada_id = v_entrada;
    EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde', v_cols, v_cols);

    UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
      descricao = 'TESTE REPARCELAR ENTRADA - Parcela 2/2', valor = 40.00,
      "valorLiquido" = 40.00, data = now() + interval '60 days';
    EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde', v_cols, v_cols);

    BEGIN
      -- Troca os valores de posição, como se faz para acertar os centavos.
      PERFORM public.reparcelar_transacao_avulsa(v_de_entrada, jsonb_build_array(
        jsonb_build_object('valor', 40.00, 'data', now() + interval '30 days'),
        jsonb_build_object('valor', 60.00, 'data', now() + interval '60 days')
      ));

      SELECT count(*), sum(valor), count(entrada_id)
        INTO v_qtd, v_soma, v_com_entrada
        FROM public.transacao
       WHERE parcelamento_id = v_de_entrada AND is_deleted = false;

      IF v_qtd = 2 AND v_soma = 100.00 AND v_com_entrada = 2 THEN
        v_ok := v_ok + 1;
        RAISE NOTICE 'OK 13: parcela de nota reparcelada, total mantido em % e vínculo preservado', v_soma;
      ELSE
        v_falhou := v_falhou + 1;
        RAISE NOTICE 'FALHOU 13: % parcelas, soma %, com entrada % (esperado 2 / 100.00 / 2)',
          v_qtd, v_soma, v_com_entrada;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 13: nota de compra foi recusada -> % (%)', SQLERRM, SQLSTATE;
    END;

    UPDATE _molde SET entrada_id = NULL;
  END IF;

  RAISE NOTICE '---';
  RAISE NOTICE '=== % passaram, % falharam ===', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Há % verificações falhando.', v_falhou;
  END IF;
END $$;

-- Nada acima é persistido.
ROLLBACK;
