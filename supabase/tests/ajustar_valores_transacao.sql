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
  v_texto       text;
  v_cols        text;
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

  /*
   * A OS escolhida entra num estado conhecido antes de receber os títulos.
   *
   * Sem isto o teste dependia do que o banco de demonstração tivesse por perto:
   * `validar_novo_recebimento_os` recusa lançamento fora de ORCAMENTO_APROVADO /
   * EM_ANDAMENTO / PAGAMENTO ou FATURAMENTO, e `validar_limite_pagamento_os`
   * recusa o que passar do orçamento — as fixtures somam R$ 300,01. O `LIMIT 1`
   * sem filtro pegava qualquer OS e o teste morria montando o cenário, antes de
   * chegar na regra que ele existe para verificar.
   *
   * ORCAMENTO_APROVADO e não PAGAMENTO porque ele é aceito nos dois modos de
   * faturamento; PAGAMENTO deixa de ser quando a etapa de faturamento está
   * ligada. Tudo isto some no ROLLBACK.
   */
  UPDATE public.ordemservico
     SET status = 'ORCAMENTO_APROVADO',
         orcamentototal = 1000,
         acrescimo_financeiro_tipo = NULL,
         acrescimo_financeiro_valor = 0
   WHERE id = v_os;

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

/*
   * Zera o que não deve vazar do molde para as linhas de teste.
   *
   * As linhas nascem PENDENTES, e isso é regra, não detalhe de fixture:
   * `transacao_valor_apos_baixa_trg` (20260806120000) recusa mudar o valor de
   * transação já baixada, e é sobre valor que esta RPC trabalha. Nascendo
   * baixadas, todo caso de rateio válido morria no gatilho — e o teste acusava a
   * RPC por uma trava que é de outra regra, e que está certa.
   *
   * É também o que a operação faz de verdade: o caso real que originou
   * 20260828150000 (OS #164 do Demir) redistribui entre as parcelas EM ABERTO;
   * as baixadas vão no payload para a soma fechar, com o valor inalterado.
   */
  UPDATE _molde SET
    ordemservicoid = v_os, vendaid = NULL, entrada_id = NULL,
    usoconsumo_entrada_id = NULL, evento_financeiro_id = NULL,
    estorno_transacao_id = NULL, is_deleted = false, pendente = true,
    data = now(), descricao = 'TESTE RPC';

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE RPC - Parcela 1/3', valor = 100.00, "valorLiquido" = 100.00;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_a;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE RPC - Parcela 2/3', valor = 100.00, "valorLiquido" = 100.00;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_b;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE RPC - Parcela 3/3', valor = 100.01, "valorLiquido" = 100.01;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_c;

  -- Avulsas: sem documento de origem.
  UPDATE _molde SET ordemservicoid = NULL;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE RPC - avulsa 1', valor = 50.00, "valorLiquido" = 50.00;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_avulsa1;

  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE RPC - avulsa 2', valor = 60.00, "valorLiquido" = 60.00;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_avulsa2;

  -- Registro legado: líquido nunca gravado.
  UPDATE _molde SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    descricao = 'TESTE RPC - sem liquido', valor = 70.00, "valorLiquido" = NULL;
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde RETURNING id', v_cols, v_cols)
    INTO v_sem_liquido;

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
