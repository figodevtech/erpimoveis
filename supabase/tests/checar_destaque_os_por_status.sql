-- Teste da coluna config_geral.destaque_os_por_status contra um banco real.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/checar_destaque_os_por_status.sql
--
-- Confere o default, o CHECK que exige objeto e a gravacao/leitura de uma regra
-- real. Tudo dentro de uma transacao que termina em ROLLBACK: nada e escrito.

BEGIN;

DO $$
DECLARE
  v_id       bigint;
  v_atual    jsonb;
  v_lido     jsonb;
  v_ok       int := 0;
  v_falhou   int := 0;
BEGIN
  /* ---------------- a coluna existe e ja tem um objeto ---------------- */
  SELECT id INTO v_id FROM public.config_geral ORDER BY id DESC LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sem linha em config_geral para testar.';
  END IF;

  SELECT destaque_os_por_status INTO v_atual FROM public.config_geral WHERE id = v_id;
  IF jsonb_typeof(v_atual) = 'object' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK: valor atual e um objeto jsonb (%).', v_atual;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU: valor atual nao e objeto (%).', v_atual;
  END IF;

  /* ---------------- grava e le uma regra real ---------------- */
  UPDATE public.config_geral
  SET destaque_os_por_status =
    '{"PAGAMENTO": {"cor": "verde", "texto": "Aguardando o cliente pagar"}}'::jsonb
  WHERE id = v_id;

  SELECT destaque_os_por_status INTO v_lido FROM public.config_geral WHERE id = v_id;
  IF v_lido -> 'PAGAMENTO' ->> 'cor' = 'verde'
     AND v_lido -> 'PAGAMENTO' ->> 'texto' = 'Aguardando o cliente pagar' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK: regra gravada e lida de volta intacta.';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU: regra voltou diferente (%).', v_lido;
  END IF;

  /* ---------------- o CHECK recusa o que nao e objeto ---------------- */
  BEGIN
    UPDATE public.config_geral SET destaque_os_por_status = '[]'::jsonb WHERE id = v_id;
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU: o CHECK aceitou um array.';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK: o CHECK recusou um array.';
  END;

  BEGIN
    UPDATE public.config_geral SET destaque_os_por_status = '"verde"'::jsonb WHERE id = v_id;
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU: o CHECK aceitou uma string.';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK: o CHECK recusou uma string.';
  END;

  RAISE NOTICE '--- % passaram, % falharam ---', v_ok, v_falhou;
  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Teste do destaque por status falhou.';
  END IF;
END $$;

ROLLBACK;
