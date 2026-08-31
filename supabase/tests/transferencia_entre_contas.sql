-- Transferência entre contas próprias.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/transferencia_entre_contas.sql
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito.
--
-- O QUE ENCENA
-- Duas contas da empresa. R$ 1.000 saem de uma e entram na outra por Pix. Depois
-- alguém tenta editar o valor de uma perna sozinha, e por fim a transferência é
-- desfeita.
--
-- O INVARIANTE
-- O dinheiro mudou de lugar, não de tamanho. Cada conta se move R$ 1.000 no
-- sentido certo, a SOMA DAS DUAS não muda em momento algum, e o resultado do
-- exercício não é tocado: nenhuma das pernas vira receita ou despesa na DRE.

BEGIN;

CREATE TEMP TABLE _criadas (id bigint PRIMARY KEY) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.saldo_do_teste(p_banco bigint)
RETURNS numeric LANGUAGE sql AS $$
  SELECT round(coalesce(sum(
    CASE WHEN upper(t.tipo::text) IN ('RECEITA','DEPOSITO')
         THEN coalesce(nullif(t."valorLiquido", 0), t.valor)
         ELSE -coalesce(nullif(t."valorLiquido", 0), t.valor) END
  ), 0), 2)
  FROM public.transacao t
  JOIN _criadas c ON c.id = t.id
  WHERE t.is_deleted = false
    AND t.pendente = false
    AND t.banco_id = p_banco;
$$;

DO $t$
DECLARE
  v_origem bigint;
  v_destino bigint;
  v_resultado jsonb;
  v_transferencia bigint;
  v_saida bigint;
  v_entrada bigint;
  v_tx public.transacao%ROWTYPE;
  v_outra public.transacao%ROWTYPE;
  v_grupo public.transacao_transferencia%ROWTYPE;
  v_sai numeric(14,2);
  v_entra numeric(14,2);
  v_n int;
  v_msg text;
  v_ok int := 0;
  v_falhou int := 0;
BEGIN
  IF to_regprocedure('public.registrar_transferencia_entre_contas(numeric,timestamptz,bigint,bigint,text,text,integer,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'registrar_transferencia_entre_contas nao existe. Rode as migrations.';
  END IF;

  /* ---------------- historico canonico ---------------- */

  SELECT count(*) INTO v_n
    FROM (
      SELECT tr.id
        FROM public.transacao_transferencia tr
        LEFT JOIN public.transacao t ON t.transferencia_id = tr.id
       GROUP BY tr.id
      HAVING count(t.id) <> 2
          OR count(*) FILTER (
               WHERE t.banco_id = tr.banco_origem_id
                 AND upper(t.tipo::text) = 'SAQUE'
             ) <> 1
          OR count(*) FILTER (
               WHERE t.banco_id = tr.banco_destino_id
                 AND upper(t.tipo::text) = 'DEPOSITO'
             ) <> 1
    ) inconsistentes;

  IF v_n = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 0a: todo o historico tem um saque na origem e um deposito no destino';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 0a: % transferencia(s) historica(s) fora do formato canonico', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.eventos_financeiros e
    JOIN public.transacao t
      ON e.source_type = 'TRANSACAO' AND e.source_id = t.id
   WHERE t.transferencia_id IS NOT NULL
     AND e.status = 'ATIVO';

  IF v_n = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 0b: nenhuma transferencia historica tem evento ativo de DRE';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 0b: % evento(s) ativo(s) de DRE no historico', v_n;
  END IF;

  /* ---------------- fixture: duas contas ---------------- */
  --
  -- Contas próprias do teste, e não as do banco: assim o saldo apurado começa em
  -- zero dos dois lados e cada número abaixo fala só da transferência.

  CREATE TEMP TABLE _molde_conta ON COMMIT DROP AS
    SELECT * FROM public.bancoconta LIMIT 1;
  IF NOT FOUND OR (SELECT count(*) FROM _molde_conta) = 0 THEN
    RAISE EXCEPTION 'Nenhum banco cadastrado para servir de molde.';
  END IF;

  UPDATE _molde_conta SET
    id = nextval(pg_get_serial_sequence('public.bancoconta','id')),
    titulo = 'TESTE CONTA ORIGEM', valorinicial = 0;
  INSERT INTO public.bancoconta SELECT * FROM _molde_conta;
  SELECT id INTO v_origem FROM _molde_conta;

  UPDATE _molde_conta SET
    id = nextval(pg_get_serial_sequence('public.bancoconta','id')),
    titulo = 'TESTE CONTA DESTINO', valorinicial = 0;
  INSERT INTO public.bancoconta SELECT * FROM _molde_conta;
  SELECT id INTO v_destino FROM _molde_conta;

  IF pg_temp.saldo_do_teste(v_origem) = 0 AND pg_temp.saldo_do_teste(v_destino) = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: duas contas do teste, ambas zeradas';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: origem=% destino=%',
      pg_temp.saldo_do_teste(v_origem), pg_temp.saldo_do_teste(v_destino);
  END IF;

  /* ---------------- 2. a transferência ---------------- */

  v_resultado := public.registrar_transferencia_entre_contas(
    1000.00, now(), v_origem, v_destino, 'PIX', NULL, NULL, NULL, NULL
  );
  v_transferencia := (v_resultado->>'transferencia_id')::bigint;
  v_saida := (v_resultado->>'saida_id')::bigint;
  v_entrada := (v_resultado->>'entrada_id')::bigint;
  INSERT INTO _criadas VALUES (v_saida), (v_entrada);

  SELECT count(*) INTO v_n
    FROM public.transacao WHERE transferencia_id = v_transferencia AND is_deleted = false;

  IF v_n = 2 AND v_saida IS DISTINCT FROM v_entrada THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: nasceram exatamente duas pernas, ligadas a transferencia #%', v_transferencia;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 2: % linhas com transferencia_id=%', v_n, v_transferencia;
  END IF;

  /* ---------------- 3. cada perna no seu sentido ---------------- */

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_saida;
  SELECT * INTO v_outra FROM public.transacao WHERE id = v_entrada;

  IF upper(v_tx.tipo::text) = 'SAQUE' AND v_tx.banco_id = v_origem
     AND upper(v_outra.tipo::text) = 'DEPOSITO' AND v_outra.banco_id = v_destino
     AND v_tx.valor = 1000.00 AND v_outra.valor = 1000.00
     AND v_tx."valorLiquido" = 1000.00 AND v_outra."valorLiquido" = 1000.00
     AND v_tx.pendente = false AND v_outra.pendente = false THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: saque de R$ 1.000,00 na origem, deposito de R$ 1.000,00 no destino, os dois liquidados';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: saida tipo=% banco=% valor=% pendente=% / entrada tipo=% banco=% valor=% pendente=%',
      v_tx.tipo, v_tx.banco_id, v_tx.valor, v_tx.pendente,
      v_outra.tipo, v_outra.banco_id, v_outra.valor, v_outra.pendente;
  END IF;

  /* ---------------- 3b. cada perna aponta para a outra conta ------------ */
  --
  -- `nomepagador` e `cpfcnpjpagador` sao NOT NULL: a RPC ja nasceu sem os dois e
  -- por isso NENHUMA transferencia era gravada. Aqui a contraparte tem que ser o
  -- titulo da OUTRA conta — e o que a conciliacao le no extrato.

  IF v_tx.nomepagador = 'TESTE CONTA DESTINO'
     AND v_outra.nomepagador = 'TESTE CONTA ORIGEM'
     AND v_tx.cpfcnpjpagador IS NOT NULL
     AND v_outra.cpfcnpjpagador IS NOT NULL THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3b: a contraparte de cada perna e o titulo da outra conta';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3b: saida pagador=% doc=% / entrada pagador=% doc=%',
      v_tx.nomepagador, v_tx.cpfcnpjpagador,
      v_outra.nomepagador, v_outra.cpfcnpjpagador;
  END IF;

  /* ---------------- 4. o dinheiro mudou de lugar, nao de tamanho --------- */

  v_sai := pg_temp.saldo_do_teste(v_origem);
  v_entra := pg_temp.saldo_do_teste(v_destino);

  IF v_sai = -1000.00 AND v_entra = 1000.00 AND (v_sai + v_entra) = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: origem em -R$ 1.000,00, destino em +R$ 1.000,00, soma das duas em zero';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: origem=% destino=% soma=%', v_sai, v_entra, v_sai + v_entra;
  END IF;

  /* ---------------- 5. a operacao guardou os proprios fatos -------------- */

  SELECT * INTO v_grupo FROM public.transacao_transferencia WHERE id = v_transferencia;

  IF v_grupo.valor = 1000.00
     AND v_grupo.banco_origem_id = v_origem
     AND v_grupo.banco_destino_id = v_destino
     AND v_grupo.metodopagamento = 'PIX'::public.metodo_pagamento THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 5: a linha da transferencia guarda valor, contas e metodo';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 5: valor=% origem=% destino=% metodo=%',
      v_grupo.valor, v_grupo.banco_origem_id, v_grupo.banco_destino_id, v_grupo.metodopagamento;
  END IF;

  /* ---------------- 6. o resultado do exercicio nao foi tocado ----------- */

  SELECT count(*) INTO v_n
    FROM public.eventos_financeiros
   WHERE source_type = 'TRANSACAO' AND source_id IN (v_saida, v_entrada)
     AND status = 'ATIVO';

  IF v_n = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 6: nenhuma das pernas virou receita ou despesa na DRE';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 6: % evento(s) de resultado nas pernas da transferencia', v_n;
  END IF;

  /* ---------------- 7. as duas aparecem no extrato ----------------------- */
  --
  -- O extrato e "liquidada e com conta". Uma transferencia TEM que aparecer nele:
  -- o dinheiro passou pelas duas contas de verdade, e quem concilia precisa ver.

  SELECT count(*) INTO v_n
    FROM public.transacao
   WHERE id IN (v_saida, v_entrada)
     AND is_deleted = false AND pendente = false AND banco_id IS NOT NULL;

  IF v_n = 2 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 7: as duas pernas entram no extrato, cada uma na sua conta';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 7: so % perna(s) no extrato', v_n;
  END IF;

  /* ---------------- 8. contas iguais ------------------------------------- */

  BEGIN
    PERFORM public.registrar_transferencia_entre_contas(
      100.00, now(), v_origem, v_origem, 'PIX', NULL, NULL, NULL, NULL
    );
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 8: transferencia de uma conta para ela mesma foi aceita';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 8: recusou origem igual a destino';
  END;

  /* ---------------- 9. valor que nao move dinheiro ----------------------- */

  BEGIN
    PERFORM public.registrar_transferencia_entre_contas(
      0, now(), v_origem, v_destino, 'PIX', NULL, NULL, NULL, NULL
    );
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 9: transferencia de zero foi aceita';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 9: recusou valor zero';
  END;

  BEGIN
    PERFORM public.registrar_transferencia_entre_contas(
      -500.00, now(), v_origem, v_destino, 'PIX', NULL, NULL, NULL, NULL
    );
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 10: transferencia negativa foi aceita';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 10: recusou valor negativo';
  END;

  /* ---------------- 11. metodo fora do enum ------------------------------ */

  BEGIN
    PERFORM public.registrar_transferencia_entre_contas(
      100.00, now(), v_origem, v_destino, 'CARTA DE CREDITO', NULL, NULL, NULL, NULL
    );
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 11: metodo inexistente foi aceito';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 11: recusou metodo de pagamento fora do enum';
  END;

  /* ---------------- 12. uma perna nao muda sozinha ----------------------- */

  BEGIN
    UPDATE public.transacao SET valor = 700.00 WHERE id = v_saida;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 12: o valor de uma perna foi editado sozinho';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg LIKE '%não muda sozinha%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 12: recusou editar o valor de uma perna, com o motivo certo';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 12: recusou, mas com outra mensagem: %', v_msg;
    END IF;
  END;

  BEGIN
    UPDATE public.transacao SET banco_id = v_destino WHERE id = v_saida;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 13: a conta de uma perna foi trocada sozinha';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 13: recusou trocar a conta de uma perna';
  END;

  BEGIN
    UPDATE public.transacao SET pendente = true WHERE id = v_entrada;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 14: uma perna foi reaberta';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 14: recusou reabrir uma perna';
  END;

  /* ---------------- 15. classificacao continua livre --------------------- */

  UPDATE public.transacao
     SET descricao = 'Transferência para a conta do imposto'
   WHERE id = v_saida;

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_saida;
  IF v_tx.descricao = 'Transferência para a conta do imposto' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 15: a descricao continua editavel — e classificacao, nao dinheiro';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 15: a descricao nao foi aceita';
  END IF;

  /* ---------------- 16. desfazer leva as duas ---------------------------- */

  UPDATE public.transacao
     SET is_deleted = true, updated_at = now()
   WHERE transferencia_id = v_transferencia;

  v_sai := pg_temp.saldo_do_teste(v_origem);
  v_entra := pg_temp.saldo_do_teste(v_destino);

  IF v_sai = 0 AND v_entra = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 16: desfeita a transferencia, as duas contas voltam ao que eram';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 16: origem=% destino=%', v_sai, v_entra;
  END IF;

  /* ---------------- 17. apagar a operacao leva as pernas ----------------- */
  --
  -- O CASCADE. Vale para o hard delete; a exclusao pela tela e soft e passa pela
  -- rota, mas se um dia alguem apagar a linha da operacao no banco, as pernas
  -- nao podem ficar apontando para o vazio.

  DELETE FROM public.transacao_transferencia WHERE id = v_transferencia;

  SELECT count(*) INTO v_n FROM public.transacao WHERE id IN (v_saida, v_entrada);
  IF v_n = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 17: apagar a operacao levou as duas pernas junto';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 17: % perna(s) sobraram sem operacao', v_n;
  END IF;

  RAISE NOTICE '---';
  RAISE NOTICE '=== % passaram, % falharam ===', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Ha % verificacoes falhando.', v_falhou;
  END IF;
END $t$;

ROLLBACK;
