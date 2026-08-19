-- Teste da baixa de título antecipado contra um banco real.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/baixa_de_titulo_antecipado.sql
--   npm run db:test:sql -- supabase/tests/baixa_de_titulo_antecipado.sql demir
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito no banco.
-- As linhas são clonadas de um registro existente (tabela temporária `_molde`),
-- então o script não precisa conhecer o schema inteiro.
--
-- O QUE ESTE TESTE ENCENA
-- O caso inteiro, na ordem em que acontece na oficina:
--
--   1. quatro parcelas a receber, boletos em cobrança;
--   2. o proprietário antecipa três e escolhe MANTER OS TÍTULOS EM ABERTO,
--      porque quer acompanhar os vencimentos;
--   3. o primeiro boleto é honrado — baixa SEM lançamento, porque o dinheiro já
--      entrou pela antecipação;
--   4. o segundo não é pago, o banco debita o valor de volta, e ele registra
--      esse débito como despesa;
--   5. o devedor paga depois — baixa COM lançamento, porque agora o dinheiro
--      entra de verdade;
--   6. ele se engana e estorna essa baixa.
--
-- O INVARIANTE
-- O mesmo dinheiro nunca entra duas vezes, e dinheiro que entrou nunca some.
-- Depois de cada passo o teste soma o que passou pela conta — o mesmo recorte do
-- extrato (`banco_id IS NOT NULL` e liquidado, que é o filtro `comBanco`) — e
-- compara com o que aconteceu no mundo.

BEGIN;

-- Isola a conta do teste do que já existe no banco: o saldo conferido é só o
-- das linhas criadas aqui.
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
  v_banco bigint;
  v_ids bigint[] := ARRAY[]::bigint[];
  v_p1 bigint; v_p2 bigint; v_p3 bigint; v_p4 bigint;
  v_avulsa bigint;
  v_adi bigint;
  v_adi2 bigint;
  v_resultado jsonb;
  v_adi_foto jsonb;
  v_tx public.transacao%ROWTYPE;
  v_saldo numeric(14,2);
  v_n int;
  v_novo bigint;
  v_ok int := 0;
  v_falhou int := 0;

BEGIN
  /* ---------------- pré-requisitos ---------------- */

  IF to_regprocedure('public.baixar_transacao_pendente(bigint,timestamptz,bigint,text,integer,integer,uuid,boolean,numeric)') IS NULL THEN
    RAISE EXCEPTION 'baixar_transacao_pendente ainda nao aceita p_lancar_no_caixa/p_valor. Rode as migrations.';
  END IF;

  IF to_regprocedure('public.baixar_transacao_pendente(bigint,timestamptz,bigint,text,integer,integer,uuid)') IS NOT NULL
     OR to_regprocedure('public.baixar_transacao_pendente(bigint,timestamptz,bigint,text,integer,integer,uuid,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'Sobrou uma assinatura antiga de baixar_transacao_pendente: a chamada por nome fica ambigua.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'transacao'
       AND column_name = 'adiantamento_manteve_pendentes'
  ) THEN
    RAISE EXCEPTION 'Falta a coluna adiantamento_manteve_pendentes. Rode as migrations.';
  END IF;

  SELECT id INTO v_banco FROM public.bancoconta ORDER BY id LIMIT 1;
  IF v_banco IS NULL THEN
    RAISE EXCEPTION 'Nenhum banco cadastrado para servir de conta.';
  END IF;

  /* ---------------- fixture: quatro parcelas de R$ 1.000 a receber -------- */

  CREATE TEMP TABLE _molde ON COMMIT DROP AS
    SELECT * FROM public.transacao WHERE is_deleted = false LIMIT 1;
  IF (SELECT count(*) FROM _molde) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma transacao para servir de molde.';
  END IF;

  FOR v_n IN 1..4 LOOP
    UPDATE _molde SET
      id = nextval(pg_get_serial_sequence('public.transacao','id')),
      ordemservicoid = NULL, vendaid = NULL, entrada_id = NULL, usoconsumo_entrada_id = NULL,
      evento_financeiro_id = NULL, estorno_transacao_id = NULL, pagamento_multiplo_id = NULL,
      adiantamento_id = NULL, eh_adiantamento = false, adiantamento_manteve_pendentes = NULL,
      parcelamento_id = NULL, is_deleted = false, pendente = true,
      tipo = 'RECEITA'::public.tipos_transacao,
      valor = 1000.00, valor_base = 1000.00, "valorLiquido" = 1000.00,
      valor_acrescimos = 0, valor_descontos = 0,
      banco_id = NULL, pago_em = NULL, baixado_por = NULL,
      vencimento_em = date_trunc('day', now() + (v_n || ' days')::interval),
      data = date_trunc('day', now() + (v_n || ' days')::interval),
      descricao = 'TESTE ANTECIPACAO PARCELA ' || v_n;

    INSERT INTO public.transacao SELECT * FROM _molde;
    SELECT id INTO v_novo FROM _molde;
    INSERT INTO _criadas VALUES (v_novo);
    v_ids := v_ids || v_novo;
  END LOOP;

  v_p1 := v_ids[1]; v_p2 := v_ids[2]; v_p3 := v_ids[3]; v_p4 := v_ids[4];

  -- Uma quinta linha, avulsa e sem antecipação, para provar que a regra nova não
  -- alcança título comum.
  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    valor = 250.00, valor_base = 250.00, "valorLiquido" = 250.00,
    descricao = 'TESTE TITULO COMUM';
  INSERT INTO public.transacao SELECT * FROM _molde;
  SELECT id INTO v_avulsa FROM _molde;
  INSERT INTO _criadas VALUES (v_avulsa);

  IF pg_temp.saldo_do_teste(v_banco) = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 0: fixture montada, nada passou pela conta ainda';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 0: conta comecou em % em vez de 0', pg_temp.saldo_do_teste(v_banco);
  END IF;

  /* ---------------- 1. antecipar 3 parcelas mantendo os titulos em aberto -- */

  v_resultado := public.baixar_por_adiantamento(
    ARRAY[v_p1, v_p2, v_p3],
    jsonb_build_object(
      'banco_id', v_banco,
      'metodopagamento', 'PIX',
      'pago_em', now()::text,
      'taxa', 0,
      'descricao', 'TESTE ANTECIPACAO DE 3 BOLETOS',
      'categoria_id', (SELECT categoria_id FROM _molde),
      'manter_titulos_pendentes', true
    ),
    NULL
  );
  v_adi := (v_resultado->>'adiantamento_id')::bigint;
  INSERT INTO _criadas VALUES (v_adi);

  -- A linha inteira da antecipação, como ela nasceu. Nada no caminho que vem a
  -- seguir tem o direito de mexer nela: o dinheiro dos R$ 3.000 entrou uma vez e
  -- fica onde está, aconteça o que acontecer com cada boleto. É o invariante
  -- mais forte deste teste, e por isso a comparação é da linha toda — qualquer
  -- coluna que mudar derruba a verificação, mesmo `updated_at`.
  SELECT to_jsonb(t) INTO v_adi_foto FROM public.transacao t WHERE t.id = v_adi;

  SELECT count(*) INTO v_n
    FROM public.transacao
   WHERE id = ANY(ARRAY[v_p1, v_p2, v_p3])
     AND pendente = true AND adiantamento_id = v_adi AND banco_id IS NULL;

  IF v_n = 3
     AND (SELECT adiantamento_manteve_pendentes FROM public.transacao WHERE id = v_adi) IS TRUE
     AND (SELECT pendente FROM public.transacao WHERE id = v_p4) IS TRUE
     AND (SELECT adiantamento_id FROM public.transacao WHERE id = v_p4) IS NULL THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: 3 titulos em aberto e marcados como antecipados; a 4a parcela intocada';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: % titulo(s) no estado esperado', v_n;
  END IF;

  -- O dinheiro entrou uma vez só, pela antecipação: 3 x 1.000.
  v_saldo := pg_temp.saldo_do_teste(v_banco);
  IF v_saldo = 3000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: entraram R$ 3.000,00 na conta, so pela antecipacao';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 2: conta em % em vez de 3000.00', v_saldo;
  END IF;

  /* ---------------- 2. o primeiro boleto e honrado: baixa SEM lancamento --- */

  PERFORM public.baixar_transacao_pendente(
    v_p1, now(), v_banco, 'BOLETO', NULL, NULL, NULL, false
  );

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_p1;
  v_saldo := pg_temp.saldo_do_teste(v_banco);

  IF v_tx.pendente = false AND v_tx.banco_id IS NULL AND v_saldo = 3000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: boleto honrado baixou sem mover a conta; segue em R$ 3.000,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: banco=%, pendente=%, conta=%', v_tx.banco_id, v_tx.pendente, v_saldo;
  END IF;

  /* ---------------- 3. o banco debita de volta a parcela nao paga --------- */

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    tipo = 'DESPESA'::public.tipos_transacao,
    valor = 1000.00, valor_base = 1000.00, "valorLiquido" = 1000.00,
    pendente = false, banco_id = v_banco, pago_em = now(), data = now(),
    vencimento_em = now(),
    descricao = 'TESTE DEVOLUCAO DE BOLETO PELO BANCO';
  INSERT INTO public.transacao SELECT * FROM _molde;
  SELECT id INTO v_novo FROM _molde;
  INSERT INTO _criadas VALUES (v_novo);

  v_saldo := pg_temp.saldo_do_teste(v_banco);
  IF v_saldo = 2000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: o debito do banco derrubou a conta para R$ 2.000,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: conta em % em vez de 2000.00', v_saldo;
  END IF;

  /* ---------------- 4. o devedor paga: baixa COM lancamento --------------- */

  v_resultado := public.baixar_transacao_pendente(
    v_p2, now(), v_banco, 'BOLETO', NULL, NULL, NULL, true
  );

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_p2;
  v_saldo := pg_temp.saldo_do_teste(v_banco);

  IF v_tx.pendente = false AND v_tx.banco_id = v_banco
     AND (v_resultado->>'lancado_no_caixa')::boolean IS TRUE
     AND v_saldo = 3000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 5: a baixa com lancamento devolveu a conta para R$ 3.000,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 5: banco=%, conta=%, retorno=%', v_tx.banco_id, v_saldo, v_resultado;
  END IF;

  -- A entrada precisa aparecer no recorte do extrato, que e por onde o
  -- proprietario confere o dia.
  SELECT count(*) INTO v_n
    FROM public.transacao
   WHERE id = v_p2 AND pendente = false AND banco_id IS NOT NULL AND is_deleted = false;
  IF v_n = 1 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 6: o titulo aparece no extrato (comBanco)';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 6: o titulo nao entrou no recorte do extrato';
  END IF;

  /* ---------------- 5. o DRE nao pode enxergar receita nova --------------- */
  -- A receita ja foi reconhecida na origem; a baixa e movimento de caixa.
  -- `sincronizar_eventos_financeiros_transacao` ignora quem tem adiantamento_id.

  SELECT count(*) INTO v_n
    FROM public.transacao WHERE id = v_p2 AND evento_financeiro_id IS NOT NULL;
  IF v_n = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 7: a baixa com lancamento nao criou receita nova';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 7: apareceu evento financeiro no titulo antecipado';
  END IF;

  /* ---------------- 6. desfazer a antecipacao e recusado agora ------------ */

  BEGIN
    PERFORM public.desfazer_adiantamento(v_adi, NULL);
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 8: desfez a antecipacao apagando uma baixa com dinheiro real';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm ILIKE '%baixado com lancamento%' OR sqlerrm ILIKE '%baixado com lançamento%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 8: recusou desfazer a antecipacao e apontou o estorno';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 8: recusou com outra mensagem: %', sqlerrm;
    END IF;
  END;

  /* ---------------- 7. estornar a baixa com lancamento -------------------- */

  PERFORM public.estornar_baixa_transacao(v_p2, NULL);

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_p2;
  v_saldo := pg_temp.saldo_do_teste(v_banco);

  IF v_tx.pendente = true AND v_tx.banco_id IS NULL
     AND v_tx.adiantamento_id = v_adi AND v_saldo = 2000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 9: estornou; o titulo voltou a antecipado em aberto e a conta a R$ 2.000,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 9: pendente=%, banco=%, adiantamento=%, conta=%',
      v_tx.pendente, v_tx.banco_id, v_tx.adiantamento_id, v_saldo;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.transacao_baixa_historico
   WHERE transacao_id = v_p2 AND operacao = 'ESTORNO';
  IF v_n = 1 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 10: o estorno ficou no livro';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 10: % linha(s) de ESTORNO no livro', v_n;
  END IF;

  /* ---------------- 8. rebaixar, agora sem lancamento --------------------- */
  -- Ele reconsidera: o dinheiro do estorno voltou, e a baixa correta e a que nao
  -- move a conta.

  PERFORM public.baixar_transacao_pendente(
    v_p2, now(), v_banco, 'BOLETO', NULL, NULL, NULL, false
  );
  SELECT * INTO v_tx FROM public.transacao WHERE id = v_p2;
  v_saldo := pg_temp.saldo_do_teste(v_banco);

  IF v_tx.banco_id IS NULL AND v_saldo = 2000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 11: rebaixou sem lancamento; a conta ficou onde estava';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 11: banco=%, conta=%', v_tx.banco_id, v_saldo;
  END IF;

  /* ---------------- 9. titulo comum nao escolhe ---------------------------- */

  BEGIN
    PERFORM public.baixar_transacao_pendente(
      v_avulsa, now(), v_banco, 'PIX', NULL, NULL, NULL, true
    );
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 12: aceitou p_lancar_no_caixa num titulo comum';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm ILIKE '%antecipado escolhe%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 12: recusou a bandeira em titulo comum';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 12: recusou com outra mensagem: %', sqlerrm;
    END IF;
  END;

  -- E a baixa comum dele continua gravando o banco, como sempre.
  PERFORM public.baixar_transacao_pendente(
    v_avulsa, now(), v_banco, 'PIX', NULL, NULL, NULL, false
  );
  SELECT * INTO v_tx FROM public.transacao WHERE id = v_avulsa;
  IF v_tx.banco_id = v_banco AND pg_temp.saldo_do_teste(v_banco) = 2250.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 13: titulo comum baixou com banco, como sempre';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 13: banco=%, conta=%', v_tx.banco_id, pg_temp.saldo_do_teste(v_banco);
  END IF;

  /* ---------------- 10. o modo que liquida na hora nao mudou -------------- */

  v_resultado := public.baixar_por_adiantamento(
    ARRAY[v_p4],
    jsonb_build_object(
      'banco_id', v_banco,
      'metodopagamento', 'PIX',
      'pago_em', now()::text,
      'taxa', 0,
      'descricao', 'TESTE ANTECIPACAO QUE LIQUIDA NA HORA',
      'categoria_id', (SELECT categoria_id FROM _molde),
      'manter_titulos_pendentes', false
    ),
    NULL
  );
  v_adi2 := (v_resultado->>'adiantamento_id')::bigint;
  INSERT INTO _criadas VALUES (v_adi2);

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_p4;
  IF v_tx.pendente = false AND v_tx.banco_id IS NULL
     AND (SELECT adiantamento_manteve_pendentes FROM public.transacao WHERE id = v_adi2) IS FALSE THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 14: o modo que liquida na hora seguiu igual';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 14: pendente=%, banco=%', v_tx.pendente, v_tx.banco_id;
  END IF;

  -- E o estorno continua recusando esse, porque a baixa e do conjunto.
  BEGIN
    PERFORM public.estornar_baixa_transacao(v_p4, NULL);
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 15: estornou um titulo liquidado pela antecipacao';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm ILIKE '%Desfaça a antecipação%' OR sqlerrm ILIKE '%Desfaca a antecipacao%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 15: seguiu recusando o estorno do titulo liquidado na hora';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 15: recusou com outra mensagem: %', sqlerrm;
    END IF;
  END;

  /* ---------------- 11. e a antecipacao limpa ainda se desfaz ------------- */

  PERFORM public.desfazer_adiantamento(v_adi2, NULL);
  SELECT * INTO v_tx FROM public.transacao WHERE id = v_p4;
  IF v_tx.pendente = true AND v_tx.adiantamento_id IS NULL
     AND (SELECT is_deleted FROM public.transacao WHERE id = v_adi2) IS TRUE THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 16: antecipacao sem baixa propria continua se desfazendo';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 16: pendente=%, adiantamento=%', v_tx.pendente, v_tx.adiantamento_id;
  END IF;

  /* ---------------- 12. a trava da Demir continua de pe ------------------- */
  -- `transacao_antecipado_sem_banco_check` virou gatilho para poder enxergar o
  -- modo da antecipação. O estrago que ele evitava — abrir o título antecipado
  -- na edição, escolher um banco e salvar pelo PATCH — precisa seguir barrado nos
  -- dois casos que existiam antes.

  -- (a) título antecipado ainda em aberto: e o caso do dialogo de edicao.
  BEGIN
    UPDATE public.transacao SET banco_id = v_banco WHERE id = v_p3;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 18: deixou dar banco a um titulo antecipado em aberto';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm ILIKE '%duas vezes%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 18: seguiu barrando banco em titulo antecipado em aberto';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 18: barrou com outra mensagem: %', sqlerrm;
    END IF;
  END;

  -- (b) titulo ja baixado SEM lancamento, editado depois para ganhar um banco.
  -- E a forma exata do estrago da Demir: o dinheiro entrou pela antecipacao e a
  -- edicao o somaria de novo. So a baixa grava banco; edicao nenhuma grava.
  BEGIN
    UPDATE public.transacao SET banco_id = v_banco WHERE id = v_p1;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 19: deixou dar banco a um titulo baixado sem lancamento';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm ILIKE '%duas vezes%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 19: seguiu barrando o caso que gerou a trava original';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 19: barrou com outra mensagem: %', sqlerrm;
    END IF;
  END;

  -- (c) e o titulo baixado COM lancamento continua editavel no resto: mexer na
  -- descricao nao pode esbarrar na trava do banco.
  PERFORM public.estornar_baixa_transacao(v_p2, NULL);
  PERFORM public.baixar_transacao_pendente(
    v_p2, now(), v_banco, 'BOLETO', NULL, NULL, NULL, true
  );
  BEGIN
    UPDATE public.transacao
       SET descricao = 'TESTE ANTECIPACAO PARCELA 2 (editada)'
     WHERE id = v_p2;
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 20: titulo baixado com lancamento segue editavel';
  EXCEPTION WHEN OTHERS THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 20: a trava do banco atrapalhou uma edicao comum: %', sqlerrm;
  END;

  -- E o estorno o devolve, para a conta fechar como o passo 13 espera.
  PERFORM public.estornar_baixa_transacao(v_p2, NULL);
  PERFORM public.baixar_transacao_pendente(
    v_p2, now(), v_banco, 'BOLETO', NULL, NULL, NULL, false
  );

  /* ---------------- 13. fechamento da conta ------------------------------- */
  -- Entrou: 3.000 da antecipacao + 250 do titulo comum. Saiu: 1.000 do debito.
  -- As parcelas 1 e 2 estao baixadas sem lancamento e nao somam nada.

  v_saldo := pg_temp.saldo_do_teste(v_banco);
  IF v_saldo = 2250.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 17: a conta fechou em R$ 2.250,00, sem contar nada duas vezes';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 17: a conta fechou em % em vez de 2250.00', v_saldo;
  END IF;

  /* ---------------- 14. a antecipacao nunca foi tocada -------------------- */
  -- Depois de tudo: uma baixa sem lancamento, o debito do banco, uma baixa com
  -- lancamento, dois estornos, duas rebaixas e uma edicao de descricao.

  IF (SELECT to_jsonb(t) FROM public.transacao t WHERE t.id = v_adi) = v_adi_foto THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 21: a antecipacao de R$ 3.000,00 seguiu intacta, coluna por coluna';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 21: a antecipacao mudou. Antes: %', v_adi_foto;
    RAISE NOTICE '            Depois: %',
      (SELECT to_jsonb(t) FROM public.transacao t WHERE t.id = v_adi);
  END IF;

  -- E o valor dela continua sendo a soma dos tres titulos, que e o que a torna
  -- coerente: se ela tivesse encolhido ou crescido, cobriria valor que ninguem
  -- deve ou deixaria titulo sem origem.
  IF (SELECT valor FROM public.transacao WHERE id = v_adi) = 3000.00
     AND (SELECT count(*) FROM public.transacao
           WHERE adiantamento_id = v_adi AND is_deleted = false) = 3 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 22: segue valendo R$ 3.000,00 e cobrindo exatamente 3 titulos';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 22: valor=%, titulos=%',
      (SELECT valor FROM public.transacao WHERE id = v_adi),
      (SELECT count(*) FROM public.transacao WHERE adiantamento_id = v_adi AND is_deleted = false);
  END IF;

  RAISE NOTICE '---';
  RAISE NOTICE '=== % passaram, % falharam ===', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Ha % verificacoes falhando.', v_falhou;
  END IF;
END $t$;

-- Nada acima é persistido.
ROLLBACK;
