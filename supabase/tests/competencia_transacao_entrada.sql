-- Teste do gatilho public.tg_transacao_competencia_entrada contra um banco real.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/competencia_transacao_entrada.sql
--
-- Tudo dentro de uma transação que termina em ROLLBACK: as entradas e as
-- transações de teste somem no fim. Nada é escrito no banco.
--
-- As linhas são clonadas de registros existentes (tabelas temporárias `_molde`),
-- então o script não precisa conhecer o schema: se a tabela ganhar uma coluna
-- NOT NULL, ele continua funcionando.

BEGIN;

DO $t$
DECLARE
  v_entrada bigint;
  v_uso bigint;
  v_emissao timestamptz := now() - interval '40 days';
  v_vencimento timestamptz := now() + interval '90 days';
  v_comp timestamptz;
  v_ok int := 0;
  v_falhou int := 0;
BEGIN
  /* ---------------- pré-requisitos ---------------- */

  IF to_regprocedure('public.tg_transacao_competencia_entrada()') IS NULL THEN
    RAISE EXCEPTION 'O gatilho de competência não existe. Rode as migrations primeiro.';
  END IF;

  /* ---------------- fixtures ---------------- */

  CREATE TEMP TABLE _molde_entrada ON COMMIT DROP AS
    SELECT * FROM public.entrada LIMIT 1;
  IF (SELECT count(*) FROM _molde_entrada) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma entrada para servir de molde.';
  END IF;

  UPDATE _molde_entrada SET id = nextval(pg_get_serial_sequence('public.entrada','id')),
    data_emissao = v_emissao;
  INSERT INTO public.entrada SELECT * FROM _molde_entrada RETURNING id INTO v_entrada;

  CREATE TEMP TABLE _molde_uso ON COMMIT DROP AS
    SELECT * FROM public.usoconsumo_entrada LIMIT 1;
  IF (SELECT count(*) FROM _molde_uso) = 1 THEN
    UPDATE _molde_uso SET id = nextval(pg_get_serial_sequence('public.usoconsumo_entrada','id')),
      data_emissao = v_emissao;
    INSERT INTO public.usoconsumo_entrada SELECT * FROM _molde_uso RETURNING id INTO v_uso;
  END IF;

  CREATE TEMP TABLE _molde_tx ON COMMIT DROP AS
    SELECT * FROM public.transacao WHERE is_deleted = false LIMIT 1;
  IF (SELECT count(*) FROM _molde_tx) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma transacao para servir de molde.';
  END IF;

  UPDATE _molde_tx SET
    ordemservicoid = NULL, vendaid = NULL, entrada_id = NULL, usoconsumo_entrada_id = NULL,
    evento_financeiro_id = NULL, estorno_transacao_id = NULL, pagamento_multiplo_id = NULL,
    adiantamento_id = NULL, eh_adiantamento = false, parcelamento_id = NULL,
    is_deleted = false, pendente = true, competencia_em = NULL,
    valor = 100.00, "valorLiquido" = 100.00, valor_acrescimos = 0, valor_descontos = 0,
    -- `data` é o vencimento da parcela: bem depois da emissão, de propósito. É a
    -- diferença entre os dois que o gatilho existe para não confundir.
    data = v_vencimento, descricao = 'TESTE COMPETENCIA';

  /* ---------------- 1. entrada de estoque ---------------- */
  UPDATE _molde_tx SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    entrada_id = v_entrada;
  INSERT INTO public.transacao SELECT * FROM _molde_tx;

  SELECT competencia_em INTO v_comp FROM public.transacao WHERE id = (SELECT id FROM _molde_tx);

  IF v_comp = v_emissao THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: estoque carimbou a emissao (%), nao o vencimento (%)',
      v_comp::date, v_vencimento::date;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: competencia ficou % (esperado %)', v_comp, v_emissao;
  END IF;

  /* ---------------- 2. entrada de uso e consumo ---------------- */
  IF v_uso IS NOT NULL THEN
    UPDATE _molde_tx SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
      entrada_id = NULL, usoconsumo_entrada_id = v_uso;
    INSERT INTO public.transacao SELECT * FROM _molde_tx;

    SELECT competencia_em INTO v_comp FROM public.transacao WHERE id = (SELECT id FROM _molde_tx);

    IF v_comp = v_emissao THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 2: uso/consumo carimbou a emissao';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 2: competencia ficou % (esperado %)', v_comp, v_emissao;
    END IF;
  END IF;

  /* ---------------- 3. competência informada não é sobrescrita ---------------- */
  UPDATE _molde_tx SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    entrada_id = v_entrada, usoconsumo_entrada_id = NULL,
    competencia_em = v_emissao - interval '10 days';
  INSERT INTO public.transacao SELECT * FROM _molde_tx;

  SELECT competencia_em INTO v_comp FROM public.transacao WHERE id = (SELECT id FROM _molde_tx);

  IF v_comp = v_emissao - interval '10 days' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: competencia informada pelo chamador foi preservada';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: competencia informada virou %', v_comp;
  END IF;

  /* ---------------- 4. lançamento avulso não é tocado ---------------- */
  UPDATE _molde_tx SET id = nextval(pg_get_serial_sequence('public.transacao','id')),
    entrada_id = NULL, usoconsumo_entrada_id = NULL, competencia_em = NULL;
  INSERT INTO public.transacao SELECT * FROM _molde_tx;

  SELECT competencia_em INTO v_comp FROM public.transacao WHERE id = (SELECT id FROM _molde_tx);

  IF v_comp IS NULL THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: lancamento avulso continua sem competencia';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: avulso ganhou competencia %', v_comp;
  END IF;

  RAISE NOTICE '---';
  RAISE NOTICE '=== % passaram, % falharam ===', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Ha % verificacoes falhando.', v_falhou;
  END IF;
END $t$;

-- Nada acima é persistido.
ROLLBACK;
