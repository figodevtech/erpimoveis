-- Teste da RPC public.ajustar_valores_transacao contra um banco real (demo).
--
-- Como rodar:
--   psql "$DATABASE_URL" -f supabase/tests/ajustar_valores_transacao.sql
--
-- Tudo acontece dentro de uma transação que termina em ROLLBACK: as linhas de
-- teste, os ajustes e o histórico somem no fim. Nada é escrito no banco.
--
-- As linhas de teste são clonadas de uma transação existente (via tabela
-- temporária `_molde`), então o script não precisa conhecer o schema — se um
-- dia a tabela ganhar uma coluna NOT NULL, ele continua funcionando.

BEGIN;

DO $$
DECLARE
  v_os          bigint;
  v_a           bigint;
  v_b           bigint;
  v_c           bigint;
  v_avulsa1     bigint;
  v_avulsa2     bigint;
  v_sem_liquido bigint;
  v_soma        numeric;
  v_qtd         int;
  v_valor       numeric;
  v_ok          int := 0;
  v_falhou      int := 0;
BEGIN
  /* ---------------- pré-requisitos ---------------- */

  IF to_regprocedure('public.ajustar_valores_transacao(jsonb,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'A função ajustar_valores_transacao não existe. Rode as migrations primeiro.';
  END IF;

  IF to_regclass('public.transacao_valor_historico') IS NULL THEN
    RAISE EXCEPTION 'A tabela transacao_valor_historico não existe. Rode as migrations primeiro.';
  END IF;

  /* ---------------- fixtures ---------------- */

  -- Uma OS que ainda não tem nenhum pagamento: a RPC exige o grupo completo,
  -- então receitas pré-existentes quebrariam a contagem.
  SELECT o.id INTO v_os
    FROM public.ordemservico o
   WHERE NOT EXISTS (
     SELECT 1 FROM public.transacao t
      WHERE t.ordemservicoid = o.id AND t.is_deleted = false
   )
   LIMIT 1;

  IF v_os IS NULL THEN
    RAISE EXCEPTION 'Nenhuma OS sem pagamentos encontrada para servir de fixture.';
  END IF;

  CREATE TEMP TABLE _molde ON COMMIT DROP AS
    SELECT * FROM public.transacao
     WHERE is_deleted = false AND upper(tipo::text) = 'RECEITA'
     LIMIT 1;

  IF (SELECT count(*) FROM _molde) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma transação de RECEITA para servir de molde.';
  END IF;

  -- Zera o que não deve vazar do molde para as linhas de teste.
  UPDATE _molde SET
    ordemservicoid = v_os, vendaid = NULL, entrada_id = NULL,
    usoconsumo_entrada_id = NULL, evento_financeiro_id = NULL,
    estorno_transacao_id = NULL, is_deleted = false, pendente = false,
    data = now(), descricao = 'TESTE RPC';

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE RPC - Parcela 1/3', valor = 100.00, "valorLiquido" = 100.00;
  INSERT INTO public.transacao SELECT * FROM _molde RETURNING id INTO v_a;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE RPC - Parcela 2/3', valor = 100.00, "valorLiquido" = 100.00;
  INSERT INTO public.transacao SELECT * FROM _molde RETURNING id INTO v_b;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE RPC - Parcela 3/3', valor = 100.01, "valorLiquido" = 100.01;
  INSERT INTO public.transacao SELECT * FROM _molde RETURNING id INTO v_c;

  -- Avulsas: sem documento de origem.
  UPDATE _molde SET ordemservicoid = NULL;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE RPC - avulsa 1', valor = 50.00, "valorLiquido" = 50.00;
  INSERT INTO public.transacao SELECT * FROM _molde RETURNING id INTO v_avulsa1;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE RPC - avulsa 2', valor = 60.00, "valorLiquido" = 60.00;
  INSERT INTO public.transacao SELECT * FROM _molde RETURNING id INTO v_avulsa2;

  -- Registro legado: líquido nunca gravado.
  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE RPC - sem liquido', valor = 70.00, "valorLiquido" = NULL;
  INSERT INTO public.transacao SELECT * FROM _molde RETURNING id INTO v_sem_liquido;

  RAISE NOTICE 'Fixtures: OS % / parcelas %, %, % / avulsas %, % / legado %',
    v_os, v_a, v_b, v_c, v_avulsa1, v_avulsa2, v_sem_liquido;
  RAISE NOTICE '---';

  /* ---------------- 1. soma diferente ---------------- */
  BEGIN
    PERFORM public.ajustar_valores_transacao(jsonb_build_array(
      jsonb_build_object('id', v_a, 'valor', 150.00, 'valorLiquido', 150.00,
                         'valorAnterior', 100.00, 'valorLiquidoAnterior', 100.00),
      jsonb_build_object('id', v_b, 'valor', 100.00, 'valorLiquido', 100.00,
                         'valorAnterior', 100.00, 'valorLiquidoAnterior', 100.00),
      jsonb_build_object('id', v_c, 'valor', 100.01, 'valorLiquido', 100.01,
                         'valorAnterior', 100.01, 'valorLiquidoAnterior', 100.01)
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: soma diferente foi aceita';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: soma diferente recusada -> %', SQLERRM;
  END;

  /* ---------------- 2. grupo incompleto ---------------- */
  BEGIN
    PERFORM public.ajustar_valores_transacao(jsonb_build_array(
      jsonb_build_object('id', v_a, 'valor', 100.00, 'valorLiquido', 100.00,
                         'valorAnterior', 100.00, 'valorLiquidoAnterior', 100.00),
      jsonb_build_object('id', v_b, 'valor', 100.00, 'valorLiquido', 100.00,
                         'valorAnterior', 100.00, 'valorLiquidoAnterior', 100.00)
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 2: grupo incompleto foi aceito';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: grupo incompleto recusado -> %', SQLERRM;
  END;

  /* ---------------- 3. líquido maior que o bruto ---------------- */
  BEGIN
    PERFORM public.ajustar_valores_transacao(jsonb_build_array(
      jsonb_build_object('id', v_a, 'valor', 100.00, 'valorLiquido', 120.00,
                         'valorAnterior', 100.00, 'valorLiquidoAnterior', 100.00),
      jsonb_build_object('id', v_b, 'valor', 100.00, 'valorLiquido', 100.00,
                         'valorAnterior', 100.00, 'valorLiquidoAnterior', 100.00),
      jsonb_build_object('id', v_c, 'valor', 100.01, 'valorLiquido', 100.01,
                         'valorAnterior', 100.01, 'valorLiquidoAnterior', 100.01)
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: líquido acima do bruto foi aceito';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: líquido acima do bruto recusado -> %', SQLERRM;
  END;

  /* ---------------- 4. parcela zerada (soma fecha mesmo assim) ---------------- */
  BEGIN
    PERFORM public.ajustar_valores_transacao(jsonb_build_array(
      jsonb_build_object('id', v_a, 'valor', 0, 'valorLiquido', 0,
                         'valorAnterior', 100.00, 'valorLiquidoAnterior', 100.00),
      jsonb_build_object('id', v_b, 'valor', 200.00, 'valorLiquido', 200.00,
                         'valorAnterior', 100.00, 'valorLiquidoAnterior', 100.00),
      jsonb_build_object('id', v_c, 'valor', 100.01, 'valorLiquido', 100.01,
                         'valorAnterior', 100.01, 'valorLiquidoAnterior', 100.01)
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: parcela zerada foi aceita';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: parcela zerada recusada -> %', SQLERRM;
  END;

  /* ---------------- 5. concorrência: valores mudaram embaixo ---------------- */
  BEGIN
    PERFORM public.ajustar_valores_transacao(jsonb_build_array(
      jsonb_build_object('id', v_a, 'valor', 100.01, 'valorLiquido', 100.01,
                         'valorAnterior', 99.00, 'valorLiquidoAnterior', 99.00),
      jsonb_build_object('id', v_b, 'valor', 100.00, 'valorLiquido', 100.00,
                         'valorAnterior', 100.00, 'valorLiquidoAnterior', 100.00),
      jsonb_build_object('id', v_c, 'valor', 100.00, 'valorLiquido', 100.00,
                         'valorAnterior', 100.01, 'valorLiquidoAnterior', 100.01)
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 5: base desatualizada foi aceita (last-write-wins)';
  EXCEPTION WHEN sqlstate '40001' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 5: base desatualizada recusada -> %', SQLERRM;
  END;

  /* ---------------- 6. base ausente ---------------- */
  BEGIN
    PERFORM public.ajustar_valores_transacao(jsonb_build_array(
      jsonb_build_object('id', v_a, 'valor', 100.01, 'valorLiquido', 100.01),
      jsonb_build_object('id', v_b, 'valor', 100.00, 'valorLiquido', 100.00),
      jsonb_build_object('id', v_c, 'valor', 100.00, 'valorLiquido', 100.00)
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 6: payload sem valorAnterior foi aceito';
  EXCEPTION WHEN sqlstate '40001' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 6: payload sem valorAnterior recusado';
  END;

  /* ---------------- 7. rateio válido ---------------- */
  BEGIN
    PERFORM public.ajustar_valores_transacao(
      jsonb_build_array(
        jsonb_build_object('id', v_a, 'valor', 100.01, 'valorLiquido', 96.51,
                           'valorAnterior', 100.00, 'valorLiquidoAnterior', 100.00),
        jsonb_build_object('id', v_b, 'valor', 100.00, 'valorLiquido', 96.50,
                           'valorAnterior', 100.00, 'valorLiquidoAnterior', 100.00),
        jsonb_build_object('id', v_c, 'valor', 100.00, 'valorLiquido', 96.50,
                           'valorAnterior', 100.01, 'valorLiquidoAnterior', 100.01)
      ),
      NULL,
      'rateio conforme extrato da maquineta'
    );

    SELECT round(sum(valor), 2) INTO v_soma
      FROM public.transacao WHERE id IN (v_a, v_b, v_c);

    IF v_soma = 300.01 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 7: rateio aplicado, soma preservada em %', v_soma;
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 7: soma virou % (esperado 300.01)', v_soma;
    END IF;

    SELECT count(*) INTO v_qtd
      FROM public.transacao_valor_historico WHERE transacao_id IN (v_a, v_b, v_c);

    IF v_qtd = 3 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 8: histórico gravou 3 linhas';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 8: histórico gravou % linhas (esperado 3)', v_qtd;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 7/8: rateio válido foi recusado -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 9. histórico é imutável ---------------- */
  BEGIN
    UPDATE public.transacao_valor_historico SET motivo = 'adulterado'
     WHERE transacao_id = v_a;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 9: histórico aceitou UPDATE';
  EXCEPTION WHEN sqlstate '55000' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 9: histórico recusou UPDATE';
  END;

  /* ---------------- 10. avulsos não vão em lote ---------------- */
  BEGIN
    PERFORM public.ajustar_valores_transacao(jsonb_build_array(
      jsonb_build_object('id', v_avulsa1, 'valor', 55.00, 'valorLiquido', 55.00,
                         'valorAnterior', 50.00, 'valorLiquidoAnterior', 50.00),
      jsonb_build_object('id', v_avulsa2, 'valor', 55.00, 'valorLiquido', 55.00,
                         'valorAnterior', 60.00, 'valorLiquidoAnterior', 60.00)
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 10: dois avulsos em lote foram aceitos';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 10: avulsos em lote recusados -> %', SQLERRM;
  END;

  /* ---------------- 11. avulso sozinho tem bruto livre ---------------- */
  BEGIN
    PERFORM public.ajustar_valores_transacao(jsonb_build_array(
      jsonb_build_object('id', v_avulsa1, 'valor', 75.00, 'valorLiquido', 75.00,
                         'valorAnterior', 50.00, 'valorLiquidoAnterior', 50.00)
    ));

    SELECT valor INTO v_valor FROM public.transacao WHERE id = v_avulsa1;

    IF v_valor = 75.00 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 11: avulso sem documento mudou o bruto livremente';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 11: bruto do avulso ficou %', v_valor;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 11: avulso livre foi recusado -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 12. líquido nulo não é falso conflito ---------------- */
  BEGIN
    -- O cliente manda o bruto como líquido anterior (valorLiquidoEfetivo);
    -- o banco tem NULL. A normalização dos dois lados precisa bater.
    PERFORM public.ajustar_valores_transacao(jsonb_build_array(
      jsonb_build_object('id', v_sem_liquido, 'valor', 70.00, 'valorLiquido', 67.20,
                         'valorAnterior', 70.00, 'valorLiquidoAnterior', 70.00)
    ));
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 12: registro com líquido nulo não acusou conflito';
  EXCEPTION WHEN sqlstate '40001' THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 12: líquido nulo virou falso conflito -> %', SQLERRM;
  WHEN OTHERS THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 12: -> % (%)', SQLERRM, SQLSTATE;
  END;

  /* ---------------- 13. transação inexistente ---------------- */
  BEGIN
    PERFORM public.ajustar_valores_transacao(jsonb_build_array(
      jsonb_build_object('id', 2147483000, 'valor', 10.00, 'valorLiquido', 10.00,
                         'valorAnterior', 10.00, 'valorLiquidoAnterior', 10.00)
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 13: id inexistente foi aceito';
  EXCEPTION WHEN sqlstate 'P0002' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 13: id inexistente recusado';
  END;

  /* ---------------- 14. id repetido ---------------- */
  BEGIN
    PERFORM public.ajustar_valores_transacao(jsonb_build_array(
      jsonb_build_object('id', v_avulsa2, 'valor', 30.00, 'valorLiquido', 30.00,
                         'valorAnterior', 60.00, 'valorLiquidoAnterior', 60.00),
      jsonb_build_object('id', v_avulsa2, 'valor', 30.00, 'valorLiquido', 30.00,
                         'valorAnterior', 60.00, 'valorLiquidoAnterior', 60.00)
    ));
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 14: id repetido foi aceito';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 14: id repetido recusado -> %', SQLERRM;
  END;

  RAISE NOTICE '---';
  RAISE NOTICE '=== % passaram, % falharam ===', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Há % verificações falhando.', v_falhou;
  END IF;
END $$;

-- Nada acima é persistido.
ROLLBACK;
