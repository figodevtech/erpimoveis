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
  v_soma      numeric;
  v_qtd       int;
  v_texto     text;
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
  INSERT INTO public.transacao SELECT * FROM _molde RETURNING id INTO v_baixada;

  UPDATE _molde SET pendente = true;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE REPARCELAR - Parcela 2/3', valor = 100.00, "valorLiquido" = 100.00,
    data = now() + interval '30 days';
  INSERT INTO public.transacao SELECT * FROM _molde RETURNING id INTO v_p1;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE REPARCELAR - Parcela 3/3', valor = 100.01, "valorLiquido" = 100.01,
    data = now() + interval '60 days';
  INSERT INTO public.transacao SELECT * FROM _molde RETURNING id INTO v_p2;

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

  /* ---------------- 2. vencimento no passado ---------------- */
  BEGIN
    PERFORM public.reparcelar_transacao_avulsa(v_grupo, jsonb_build_array(
      jsonb_build_object('valor', 200.01, 'data', now() - interval '1 day')
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 2: vencimento no passado foi aceito';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: vencimento no passado recusado -> %', SQLERRM;
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

  /* ---------------- 11. grupo com vínculo a documento ---------------- */
  SELECT o.id INTO v_os FROM public.ordemservico o LIMIT 1;

  IF v_os IS NOT NULL THEN
    INSERT INTO public.transacao_parcelamento (descricao)
    VALUES ('TESTE REPARCELAR VINCULADO')
    RETURNING id INTO v_vinculado;

    UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
      descricao = 'TESTE REPARCELAR VINCULADO - Parcela 1/1', valor = 10.00,
      "valorLiquido" = 10.00, data = now() + interval '30 days',
      pendente = true, parcelamento_id = v_vinculado, ordemservicoid = v_os;
    INSERT INTO public.transacao SELECT * FROM _molde;

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
  INSERT INTO public.transacao SELECT * FROM _molde RETURNING id INTO v_p3;

  BEGIN
    PERFORM public.reparcelar_transacao_avulsa(v_com_ajuste, jsonb_build_array(
      jsonb_build_object('valor', 55.00, 'data', now() + interval '30 days'),
      jsonb_build_object('valor', 55.00, 'data', now() + interval '60 days')
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 12: parcela com acréscimo foi reparcelada';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 12: parcela com acréscimo recusada -> %', SQLERRM;
  END;

  RAISE NOTICE '---';
  RAISE NOTICE '=== % passaram, % falharam ===', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Há % verificações falhando.', v_falhou;
  END IF;
END $$;

-- Nada acima é persistido.
ROLLBACK;
