-- Editar e excluir o lançamento manual do crédito do cliente.
--
-- Como rodar (banco com a migration 20261001120000 aplicada):
--   npm run db:test:sql -- supabase/tests/credito_cliente_editar_excluir.sql
-- Antes do deploy, `npm run db:test:credito-editar` aplica as migrations
-- pendentes e roda este mesmo arquivo, tudo revertido.
--
-- Prova:
--   1. editar o valor recalcula a fotografia das linhas seguintes e o saldo;
--   2. excluir tira a linha e recalcula;
--   3. reduzir ou excluir crédito já consumido por uma baixa é recusado;
--   4. UPDATE/DELETE fora das RPCs e em linha de transação continuam recusados;
--   5. edição e exclusão ficam na auditoria.
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito.

BEGIN;

DO $$
DECLARE
  v_cliente integer;
  v_transacao bigint;
  v_a bigint;
  v_b bigint;
  v_t bigint;
  v_saldo numeric;
  v_ant numeric;
  v_res numeric;
  v_auditoria_antes bigint;
  v_auditoria_depois bigint;
  v_recusou boolean;
BEGIN
  IF to_regprocedure('public.editar_movimento_saldo_cliente(integer, bigint, text, numeric, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'editar_movimento_saldo_cliente não existe. Aplique a migration 20261001120000.';
  END IF;

  -- Um cliente sem nenhum movimento, para a conta começar do zero.
  SELECT c.id INTO v_cliente
    FROM public.cliente c
   WHERE c.is_deleted = false
     AND NOT EXISTS (SELECT 1 FROM public.cliente_saldo_movimento m WHERE m.cliente_id = c.id)
   ORDER BY c.id
   LIMIT 1;
  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'Nenhum cliente sem movimento de crédito para servir de fixture.';
  END IF;

  SELECT t.id INTO v_transacao FROM public.transacao t ORDER BY t.id LIMIT 1;
  IF v_transacao IS NULL THEN
    RAISE EXCEPTION 'Nenhuma transação para servir de referência.';
  END IF;

  SELECT count(*) INTO v_auditoria_antes
    FROM public.auditoria_evento WHERE tabela = 'cliente_saldo_movimento';

  /* ---------------- 1. editar o valor ---------------- */

  v_a := (public.ajustar_saldo_credito_cliente(v_cliente, 'CREDITO', 100, 'Crédito de teste', NULL) ->> 'movimento_id')::bigint;
  v_b := (public.ajustar_saldo_credito_cliente(v_cliente, 'DEBITO', 30, 'Débito de teste', NULL) ->> 'movimento_id')::bigint;

  v_saldo := (public.editar_movimento_saldo_cliente(v_cliente, v_a, 'CREDITO', 80, 'Crédito corrigido', NULL) ->> 'saldo')::numeric;
  IF v_saldo <> 50 THEN
    RAISE EXCEPTION '1: saldo após editar deveria ser 50, veio %', v_saldo;
  END IF;

  SELECT saldo_anterior, saldo_resultante INTO v_ant, v_res
    FROM public.cliente_saldo_movimento WHERE id = v_b;
  IF (v_ant, v_res) IS DISTINCT FROM (80::numeric, 50::numeric) THEN
    RAISE EXCEPTION '1: fotografia da linha seguinte deveria ser 80 → 50, veio % → %', v_ant, v_res;
  END IF;

  IF (SELECT saldo_credito FROM public.cliente WHERE id = v_cliente) <> 50 THEN
    RAISE EXCEPTION '1: cliente.saldo_credito não acompanhou a edição.';
  END IF;

  IF (SELECT updated_at FROM public.cliente_saldo_movimento WHERE id = v_a) IS NULL THEN
    RAISE EXCEPTION '1: updated_at não foi preenchido.';
  END IF;

  -- Só o motivo.
  PERFORM public.editar_movimento_saldo_cliente(v_cliente, v_b, 'DEBITO', 30, 'Débito renomeado', NULL);
  IF (SELECT motivo FROM public.cliente_saldo_movimento WHERE id = v_b) <> 'Débito renomeado' THEN
    RAISE EXCEPTION '1: motivo não foi editado.';
  END IF;
  RAISE NOTICE 'ok 1 - editar recalcula a fotografia e o saldo';

  /* ---------------- 2. excluir ---------------- */

  v_saldo := (public.excluir_movimento_saldo_cliente(v_cliente, v_b, NULL) ->> 'saldo')::numeric;
  IF v_saldo <> 80 OR EXISTS (SELECT 1 FROM public.cliente_saldo_movimento WHERE id = v_b) THEN
    RAISE EXCEPTION '2: excluir deveria deixar saldo 80 e apagar a linha (saldo %).', v_saldo;
  END IF;
  RAISE NOTICE 'ok 2 - excluir apaga a linha e recalcula';

  /* ---------------- 3. crédito já consumido ---------------- */

  -- O consumo por baixa, como baixar_com_credito_cliente grava.
  INSERT INTO public.cliente_saldo_movimento (
    cliente_id, sentido, origem, acao, valor, saldo_anterior, saldo_resultante, transacao_id, motivo
  ) VALUES (
    v_cliente, 'DEBITO', 'TRANSACAO', 'REGISTRO', 80, 80, 0, v_transacao, 'Baixa de teste'
  ) RETURNING id INTO v_t;

  v_recusou := false;
  BEGIN
    PERFORM public.editar_movimento_saldo_cliente(v_cliente, v_a, 'CREDITO', 50, NULL, NULL);
  EXCEPTION WHEN sqlstate '22023' THEN v_recusou := true;
  END;
  IF NOT v_recusou THEN RAISE EXCEPTION '3: reduzir crédito consumido deveria ser recusado.'; END IF;

  v_recusou := false;
  BEGIN
    PERFORM public.excluir_movimento_saldo_cliente(v_cliente, v_a, NULL);
  EXCEPTION WHEN sqlstate '22023' THEN v_recusou := true;
  END;
  IF NOT v_recusou THEN RAISE EXCEPTION '3: excluir crédito consumido deveria ser recusado.'; END IF;

  -- Aumentar continua possível, e a linha da baixa é refotografada.
  v_saldo := (public.editar_movimento_saldo_cliente(v_cliente, v_a, 'CREDITO', 120, NULL, NULL) ->> 'saldo')::numeric;
  SELECT saldo_anterior, saldo_resultante INTO v_ant, v_res
    FROM public.cliente_saldo_movimento WHERE id = v_t;
  IF v_saldo <> 40 OR (v_ant, v_res) IS DISTINCT FROM (120::numeric, 40::numeric) THEN
    RAISE EXCEPTION '3: aumentar deveria dar saldo 40 e baixa 120 → 40 (saldo %, baixa % → %).', v_saldo, v_ant, v_res;
  END IF;
  RAISE NOTICE 'ok 3 - crédito consumido não pode ser reduzido nem excluído';

  /* ---------------- 4. as portas fechadas ---------------- */

  v_recusou := false;
  BEGIN
    UPDATE public.cliente_saldo_movimento SET motivo = 'por fora' WHERE id = v_a;
  EXCEPTION WHEN sqlstate '42501' THEN v_recusou := true;
  END;
  IF NOT v_recusou THEN RAISE EXCEPTION '4: UPDATE direto deveria ser recusado.'; END IF;

  v_recusou := false;
  BEGIN
    DELETE FROM public.cliente_saldo_movimento WHERE id = v_a;
  EXCEPTION WHEN sqlstate '42501' THEN v_recusou := true;
  END;
  IF NOT v_recusou THEN RAISE EXCEPTION '4: DELETE direto deveria ser recusado.'; END IF;

  v_recusou := false;
  BEGIN
    PERFORM public.editar_movimento_saldo_cliente(v_cliente, v_t, 'DEBITO', 10, NULL, NULL);
  EXCEPTION WHEN sqlstate '22023' THEN v_recusou := true;
  END;
  IF NOT v_recusou THEN RAISE EXCEPTION '4: editar linha de transação deveria ser recusado.'; END IF;

  v_recusou := false;
  BEGIN
    PERFORM public.excluir_movimento_saldo_cliente(v_cliente, v_t, NULL);
  EXCEPTION WHEN sqlstate '22023' THEN v_recusou := true;
  END;
  IF NOT v_recusou THEN RAISE EXCEPTION '4: excluir linha de transação deveria ser recusado.'; END IF;

  -- Mesmo com a flag ligada, a linha de transação só aceita a fotografia.
  v_recusou := false;
  BEGIN
    PERFORM set_config('app.razao_credito_reescrita', 'on', true);
    UPDATE public.cliente_saldo_movimento SET valor = 10 WHERE id = v_t;
  EXCEPTION WHEN sqlstate '42501' THEN v_recusou := true;
  END;
  PERFORM set_config('app.razao_credito_reescrita', 'off', true);
  IF NOT v_recusou THEN RAISE EXCEPTION '4: mudar o valor da linha de transação deveria ser recusado.'; END IF;
  RAISE NOTICE 'ok 4 - fora das RPCs e na linha de transação, nada muda';

  /* ---------------- 5. auditoria ---------------- */

  SELECT count(*) INTO v_auditoria_depois
    FROM public.auditoria_evento WHERE tabela = 'cliente_saldo_movimento';
  -- Três edições de conteúdo (100→80, motivo, 80→120) e uma exclusão.
  IF v_auditoria_depois - v_auditoria_antes <> 4 THEN
    RAISE EXCEPTION '5: esperava 4 eventos de auditoria, vieram %.', v_auditoria_depois - v_auditoria_antes;
  END IF;
  RAISE NOTICE 'ok 5 - edição e exclusão auditadas';
END;
$$;

ROLLBACK;
