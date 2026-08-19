-- Testes das colunas de alvo do orcamento avulso.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/orcamento_alvo.sql
--   npm run db:test:sql -- supabase/tests/orcamento_alvo.sql demir
--
-- Tudo dentro de uma transacao que termina em ROLLBACK: nada e escrito no banco.
--
-- O que esta sendo protegido: o alvo e exclusivo. Trocar de tipo tem que limpar
-- o anterior, senao a conversao em OS teria dois candidatos e a impressao
-- mostraria o alvo errado.

BEGIN;

DO $t$
DECLARE
  v_veiculo integer;
  v_id bigint;
  v_ok int := 0;
  v_falhou int := 0;
BEGIN
  /* ---------------- pre-requisitos ---------------- */

  IF to_regclass('public.orcamento') IS NULL THEN
    RAISE EXCEPTION 'A tabela public.orcamento nao existe. Rode as migrations primeiro.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orcamento' AND column_name = 'alvo_tipo'
  ) THEN
    RAISE EXCEPTION 'A coluna orcamento.alvo_tipo nao existe. Rode a migration 20260818160000.';
  END IF;

  SELECT id INTO v_veiculo FROM public.veiculo ORDER BY id LIMIT 1;

  /* ---------------- 1. padrao e VEICULO ---------------- */

  INSERT INTO public.orcamento (status) VALUES ('ABERTO') RETURNING id INTO v_id;

  IF (SELECT alvo_tipo FROM public.orcamento WHERE id = v_id) = 'VEICULO' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK  1) orcamento novo nasce com alvo_tipo = VEICULO';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 1) alvo_tipo padrao diferente de VEICULO';
  END IF;

  /* ---------------- 2. tipo fora da lista e barrado ---------------- */

  BEGIN
    UPDATE public.orcamento SET alvo_tipo = 'FROTA' WHERE id = v_id;
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 2) alvo_tipo invalido foi aceito';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK  2) alvo_tipo fora de VEICULO/PECA/EQUIPAMENTO e barrado';
  END;

  /* ---------------- 3. VEICULO nao carrega peca ---------------- */

  BEGIN
    UPDATE public.orcamento
       SET alvo_tipo = 'VEICULO', peca_titulo = 'bomba injetora'
     WHERE id = v_id;
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 3) alvo VEICULO aceitou peca_titulo preenchido';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK  3) alvo VEICULO recusa peca_titulo';
  END;

  /* ---------------- 4. PECA nao carrega veiculo ---------------- */

  IF v_veiculo IS NULL THEN
    RAISE NOTICE 'PULADO 4) nenhum veiculo cadastrado para testar a exclusividade';
  ELSE
    BEGIN
      UPDATE public.orcamento
         SET alvo_tipo = 'PECA', peca_titulo = 'bomba injetora', veiculoid = v_veiculo
       WHERE id = v_id;
      v_falhou := v_falhou + 1;
      RAISE WARNING 'FALHOU 4) alvo PECA aceitou veiculoid preenchido';
    EXCEPTION WHEN check_violation THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK  4) alvo PECA recusa veiculoid';
    END;
  END IF;

  /* ---------------- 5. PECA limpa e aceita ---------------- */

  UPDATE public.orcamento
     SET alvo_tipo = 'PECA',
         veiculoid = NULL,
         equipamento_nome = NULL,
         peca_titulo = 'bomba injetora',
         peca_descricao = 'Bosch VE',
         peca_lacre = 'LC-9081'
   WHERE id = v_id;

  IF (SELECT peca_titulo FROM public.orcamento WHERE id = v_id) = 'bomba injetora' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK  5) alvo PECA coerente e gravado';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 5) alvo PECA coerente nao gravou';
  END IF;

  /* ---------------- 6. EQUIPAMENTO valida ano e horimetro ---------------- */

  BEGIN
    UPDATE public.orcamento
       SET alvo_tipo = 'EQUIPAMENTO',
           peca_titulo = NULL,
           peca_descricao = NULL,
           peca_lacre = NULL,
           equipamento_nome = 'retroescavadeira',
           equipamento_ano = 1200
     WHERE id = v_id;
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 6) ano de equipamento fora da faixa foi aceito';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK  6) ano de equipamento fora de 1900..3000 e barrado';
  END;

  BEGIN
    UPDATE public.orcamento
       SET alvo_tipo = 'EQUIPAMENTO',
           peca_titulo = NULL,
           peca_descricao = NULL,
           peca_lacre = NULL,
           equipamento_nome = 'retroescavadeira',
           equipamento_ano = 2019,
           equipamento_horimetro = -1
     WHERE id = v_id;
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 7) horimetro negativo foi aceito';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK  7) horimetro negativo e barrado';
  END;

  /* ---------------- 8. EQUIPAMENTO coerente e aceito ---------------- */

  UPDATE public.orcamento
     SET alvo_tipo = 'EQUIPAMENTO',
         veiculoid = NULL,
         peca_titulo = NULL,
         peca_descricao = NULL,
         peca_lacre = NULL,
         equipamento_nome = 'retroescavadeira 416E',
         equipamento_patrimonio = 'PAT-77',
         equipamento_ano = 2019,
         equipamento_horimetro = 4820.5
   WHERE id = v_id;

  IF (SELECT equipamento_nome FROM public.orcamento WHERE id = v_id) = 'retroescavadeira 416E' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK  8) alvo EQUIPAMENTO coerente e gravado';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 8) alvo EQUIPAMENTO coerente nao gravou';
  END IF;

  /* ---------------- resultado ---------------- */

  RAISE NOTICE '--------------------------------';
  RAISE NOTICE 'Passaram: %  |  Falharam: %', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Ha % teste(s) falhando.', v_falhou;
  END IF;
END
$t$;

ROLLBACK;
