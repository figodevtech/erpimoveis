-- Teste da migration 20260923020000_status_os_emissao_nf contra um banco real.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/status_os_emissao_nf.sql demo
--
-- Derruba a coluna (se já existir) e reaplica a migration dentro da transação,
-- para testar o backfill mesmo depois do deploy. Termina em ROLLBACK.

BEGIN;

ALTER TABLE public.config_geral DROP COLUMN IF EXISTS emissao_nf_status_os;

-- Duas configs, uma com o switch antigo ligado e outra desligado.
CREATE TEMP TABLE _cfg_teste (rotulo text, id bigint) ON COMMIT DROP;
WITH ligado AS (
  INSERT INTO public.config_geral (emissao_nf_ordens_nao_pagas) VALUES (true) RETURNING id
), desligado AS (
  INSERT INTO public.config_geral (emissao_nf_ordens_nao_pagas) VALUES (false) RETURNING id
)
INSERT INTO _cfg_teste
SELECT 'ligado', id FROM ligado
UNION ALL
SELECT 'desligado', id FROM desligado;

-- Corpo da migration.
ALTER TABLE public.config_geral
  ADD COLUMN IF NOT EXISTS emissao_nf_status_os public.enum_status_os[];

UPDATE public.config_geral
   SET emissao_nf_status_os = CASE
         WHEN emissao_nf_ordens_nao_pagas
           THEN ARRAY['PAGAMENTO', 'FATURAMENTO', 'CONCLUIDO']::public.enum_status_os[]
         ELSE ARRAY['CONCLUIDO']::public.enum_status_os[]
       END
 WHERE emissao_nf_status_os IS NULL;

ALTER TABLE public.config_geral
  ALTER COLUMN emissao_nf_status_os
    SET DEFAULT ARRAY['PAGAMENTO', 'FATURAMENTO', 'CONCLUIDO']::public.enum_status_os[];

ALTER TABLE public.config_geral
  ALTER COLUMN emissao_nf_status_os SET NOT NULL;

ALTER TABLE public.config_geral
  DROP CONSTRAINT IF EXISTS config_geral_emissao_nf_status_os_chk;

ALTER TABLE public.config_geral
  ADD CONSTRAINT config_geral_emissao_nf_status_os_chk
  CHECK (
    cardinality(emissao_nf_status_os) >= 1
    AND NOT ('CANCELADO'::public.enum_status_os = ANY (emissao_nf_status_os))
  );

DO $$
DECLARE
  v_ligado    bigint;
  v_desligado bigint;
  v_novo      bigint;
  v_lido      text[];
  v_ok        int := 0;
  v_falhou    int := 0;
BEGIN
  SELECT id INTO v_ligado FROM _cfg_teste WHERE rotulo = 'ligado';
  SELECT id INTO v_desligado FROM _cfg_teste WHERE rotulo = 'desligado';

  /* ---------------- backfill preserva o comportamento ---------------- */
  SELECT emissao_nf_status_os::text[] INTO v_lido FROM public.config_geral WHERE id = v_ligado;
  IF v_lido = ARRAY['PAGAMENTO', 'FATURAMENTO', 'CONCLUIDO'] THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK: switch ligado virou os três status.';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU: switch ligado virou %.', v_lido;
  END IF;

  SELECT emissao_nf_status_os::text[] INTO v_lido FROM public.config_geral WHERE id = v_desligado;
  IF v_lido = ARRAY['CONCLUIDO'] THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK: switch desligado virou só CONCLUIDO.';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU: switch desligado virou %.', v_lido;
  END IF;

  /* ---------------- config nova nasce com os três ---------------- */
  INSERT INTO public.config_geral DEFAULT VALUES RETURNING id INTO v_novo;
  SELECT emissao_nf_status_os::text[] INTO v_lido FROM public.config_geral WHERE id = v_novo;
  IF v_lido = ARRAY['PAGAMENTO', 'FATURAMENTO', 'CONCLUIDO'] THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK: config nova nasce com os três status.';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU: config nova nasceu com %.', v_lido;
  END IF;

  /* ---------------- grava uma escolha fora do padrão ---------------- */
  UPDATE public.config_geral
     SET emissao_nf_status_os = ARRAY['EM_ANDAMENTO', 'SEM_COBRANCA']::public.enum_status_os[]
   WHERE id = v_novo;
  SELECT emissao_nf_status_os::text[] INTO v_lido FROM public.config_geral WHERE id = v_novo;
  IF v_lido = ARRAY['EM_ANDAMENTO', 'SEM_COBRANCA'] THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK: escolha customizada gravada e lida de volta.';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU: escolha customizada voltou %.', v_lido;
  END IF;

  /* ---------------- CHECK: lista vazia ---------------- */
  BEGIN
    UPDATE public.config_geral SET emissao_nf_status_os = '{}'::public.enum_status_os[] WHERE id = v_novo;
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU: o CHECK aceitou lista vazia.';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK: o CHECK recusou lista vazia.';
  END;

  /* ---------------- CHECK: CANCELADO ---------------- */
  BEGIN
    UPDATE public.config_geral
       SET emissao_nf_status_os = ARRAY['CONCLUIDO', 'CANCELADO']::public.enum_status_os[]
     WHERE id = v_novo;
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU: o CHECK aceitou CANCELADO.';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK: o CHECK recusou CANCELADO.';
  END;

  /* ---------------- enum: status inexistente ---------------- */
  BEGIN
    UPDATE public.config_geral SET emissao_nf_status_os = ARRAY['XPTO']::public.enum_status_os[] WHERE id = v_novo;
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU: o enum aceitou status inexistente.';
  EXCEPTION WHEN invalid_text_representation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK: o enum recusou status inexistente.';
  END;

  RAISE NOTICE '---- % ok, % falhou ----', v_ok, v_falhou;
  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Teste falhou em % verificação(ões).', v_falhou;
  END IF;
END $$;

ROLLBACK;
