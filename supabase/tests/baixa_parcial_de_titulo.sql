-- Baixa parcial de título, contra um banco real.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/baixa_parcial_de_titulo.sql
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito.
--
-- O QUE ENCENA
-- Título a receber de R$ 1.000. O cliente paga R$ 400 hoje e R$ 600 depois. Cada
-- pagamento é uma transação própria no extrato; o título carrega o saldo e só sai
-- de aberto quando as duas somam o valor cheio.
--
-- O INVARIANTE
-- A conta recebe exatamente o que foi pago, nunca o valor do título. E a soma do
-- que o documento tem a receber não muda por causa da forma de pagar: R$ 400
-- recebidos + R$ 600 a receber continuam sendo os mesmos R$ 1.000.

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
  v_banco bigint;
  v_titulo bigint;
  v_despesa bigint;
  v_comum bigint;
  v_com_banco bigint;
  v_filha_banco bigint;
  v_filha1 bigint;
  v_filha2 bigint;
  v_resultado jsonb;
  v_tx public.transacao%ROWTYPE;
  v_saldo numeric(14,2);
  v_n int;
  v_ok int := 0;
  v_falhou int := 0;
BEGIN
  IF to_regprocedure('public.baixar_transacao_pendente(bigint,timestamptz,bigint,text,integer,integer,uuid,numeric,numeric)') IS NULL THEN
    RAISE EXCEPTION 'baixar_transacao_pendente ainda nao aceita p_valor_lancado. Rode as migrations.';
  END IF;

  SELECT id INTO v_banco FROM public.bancoconta ORDER BY id LIMIT 1;
  IF v_banco IS NULL THEN RAISE EXCEPTION 'Nenhum banco cadastrado.'; END IF;

  /* ---------------- fixture ---------------- */

  CREATE TEMP TABLE _molde ON COMMIT DROP AS
    SELECT * FROM public.transacao WHERE is_deleted = false LIMIT 1;

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    ordemservicoid = NULL, vendaid = NULL, entrada_id = NULL, usoconsumo_entrada_id = NULL,
    evento_financeiro_id = NULL, estorno_transacao_id = NULL, pagamento_multiplo_id = NULL,
    adiantamento_id = NULL, eh_adiantamento = false, adiantamento_manteve_pendentes = NULL,
    baixa_de_transacao_id = NULL, valor_baixado = 0,
    parcelamento_id = NULL, is_deleted = false, pendente = true,
    tipo = 'RECEITA'::public.tipos_transacao,
    valor = 1000.00, valor_base = 1000.00, "valorLiquido" = 1000.00,
    valor_acrescimos = 0, valor_descontos = 0,
    banco_id = NULL, pago_em = NULL, baixado_por = NULL,
    vencimento_em = date_trunc('day', now() + interval '10 days'),
    data = date_trunc('day', now() + interval '10 days'),
    descricao = 'TESTE BAIXA PARCIAL A RECEBER';
  INSERT INTO public.transacao SELECT * FROM _molde;
  SELECT id INTO v_titulo FROM _molde;
  INSERT INTO _criadas VALUES (v_titulo);

  IF pg_temp.saldo_do_teste(v_banco) = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: titulo de R$ 1.000,00 em aberto, conta zerada';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: conta em %', pg_temp.saldo_do_teste(v_banco);
  END IF;

  /* ---------------- 2. paga R$ 400 ---------------- */

  v_resultado := public.baixar_transacao_pendente(
    v_titulo, now(), v_banco, 'PIX', NULL, NULL, NULL, 400.00, NULL
  );
  v_filha1 := (v_resultado->>'baixa_id')::bigint;
  INSERT INTO _criadas VALUES (v_filha1);

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_titulo;
  v_saldo := pg_temp.saldo_do_teste(v_banco);

  IF v_tx.pendente = true AND v_tx.valor_baixado = 400.00
     AND v_tx.banco_id IS NULL AND v_saldo = 400.00
     AND (v_resultado->>'saldo')::numeric = 600.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: entraram R$ 400,00; titulo segue aberto com saldo de R$ 600,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 2: pendente=%, baixado=%, banco=%, conta=%',
      v_tx.pendente, v_tx.valor_baixado, v_tx.banco_id, v_saldo;
  END IF;

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_filha1;
  IF v_tx.banco_id = v_banco AND v_tx.valor = 400.00 AND v_tx.pendente = false
     AND v_tx.baixa_de_transacao_id = v_titulo
     AND v_tx.ordemservicoid IS NULL AND v_tx.vendaid IS NULL THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: a filha carrega o dinheiro, aponta para o titulo e nao tem vinculo de documento';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: banco=%, valor=%, pai=%', v_tx.banco_id, v_tx.valor, v_tx.baixa_de_transacao_id;
  END IF;

  /* ---------------- 3. recusas ---------------- */

  BEGIN
    PERFORM public.baixar_transacao_pendente(
      v_titulo, now(), v_banco, 'PIX', NULL, NULL, NULL, 700.00, NULL
    );
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: aceitou baixa acima do saldo';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm ILIKE '%passa do saldo%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 4: recusou baixa acima do saldo';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 4: recusou com outra mensagem: %', sqlerrm;
    END IF;
  END;

  BEGIN
    PERFORM public.baixar_transacao_pendente(
      v_titulo, now(), v_banco, 'PIX', NULL, NULL, NULL, 0, NULL
    );
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 5: aceitou baixa de valor zero';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm ILIKE '%maior que zero%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 5: recusou baixa de valor zero';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 5: recusou com outra mensagem: %', sqlerrm;
    END IF;
  END;

  BEGIN
    UPDATE public.transacao SET banco_id = v_banco WHERE id = v_titulo;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 6: deixou dar banco a um titulo pago em partes';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm ILIKE '%duas vezes%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 6: recusou banco em titulo que tem baixas parciais';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 6: recusou com outra mensagem: %', sqlerrm;
    END IF;
  END;

  /* ---------------- 4. paga os R$ 600 restantes ---------------- */

  v_resultado := public.baixar_transacao_pendente(
    v_titulo, now(), v_banco, 'PIX', NULL, NULL, NULL, 600.00, NULL
  );
  v_filha2 := (v_resultado->>'baixa_id')::bigint;
  INSERT INTO _criadas VALUES (v_filha2);

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_titulo;
  v_saldo := pg_temp.saldo_do_teste(v_banco);

  IF v_tx.pendente = false AND v_tx.valor_baixado = 1000.00
     AND v_tx.banco_id IS NULL AND v_tx.pago_em IS NOT NULL AND v_saldo = 1000.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 7: o segundo pagamento fechou o titulo; conta em R$ 1.000,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 7: pendente=%, baixado=%, conta=%',
      v_tx.pendente, v_tx.valor_baixado, v_saldo;
  END IF;

  /* ---------------- 5. estornar um dos pagamentos ---------------- */

  PERFORM public.estornar_baixa_transacao(v_filha2, NULL);

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_titulo;
  v_saldo := pg_temp.saldo_do_teste(v_banco);

  IF v_tx.pendente = true AND v_tx.valor_baixado = 400.00 AND v_saldo = 400.00
     AND NOT EXISTS (SELECT 1 FROM public.transacao WHERE id = v_filha2) THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 8: estornou o pagamento; titulo reabriu com saldo de R$ 600,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 8: pendente=%, baixado=%, conta=%',
      v_tx.pendente, v_tx.valor_baixado, v_saldo;
  END IF;

  -- O titulo inteiro nao se estorna enquanto tem pagamentos parciais.
  BEGIN
    PERFORM public.estornar_baixa_transacao(v_titulo, NULL);
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 9: estornou o titulo inteiro por cima das baixas parciais';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm ILIKE '%pago em partes%' OR sqlerrm ILIKE '%nao esta liquidada%'
       OR sqlerrm ILIKE '%não está liquidada%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 9: mandou estornar os pagamentos um a um';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 9: recusou com outra mensagem: %', sqlerrm;
    END IF;
  END;

  /* ---------------- 6. a baixa de uma vez nao mudou ---------------- */

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    valor = 250.00, valor_base = 250.00, "valorLiquido" = 250.00,
    valor_baixado = 0, baixa_de_transacao_id = NULL, pendente = true,
    banco_id = NULL, pago_em = NULL,
    descricao = 'TESTE BAIXA DE UMA VEZ';
  INSERT INTO public.transacao SELECT * FROM _molde;
  SELECT id INTO v_comum FROM _molde;
  INSERT INTO _criadas VALUES (v_comum);

  PERFORM public.baixar_transacao_pendente(
    v_comum, now(), v_banco, 'PIX', NULL, NULL, NULL, NULL, NULL
  );
  SELECT * INTO v_tx FROM public.transacao WHERE id = v_comum;

  IF v_tx.pendente = false AND v_tx.banco_id = v_banco AND v_tx.valor_baixado = 0
     AND NOT EXISTS (SELECT 1 FROM public.transacao WHERE baixa_de_transacao_id = v_comum) THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 10: baixa de uma vez segue gravando o banco no proprio titulo';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 10: pendente=%, banco=%, baixado=%',
      v_tx.pendente, v_tx.banco_id, v_tx.valor_baixado;
  END IF;

  /* ---------------- 7. o mesmo em DESPESA ---------------- */

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    tipo = 'DESPESA'::public.tipos_transacao,
    valor = 900.00, valor_base = 900.00, "valorLiquido" = 900.00,
    valor_baixado = 0, baixa_de_transacao_id = NULL, pendente = true,
    banco_id = NULL, pago_em = NULL,
    descricao = 'TESTE BAIXA PARCIAL A PAGAR';
  INSERT INTO public.transacao SELECT * FROM _molde;
  SELECT id INTO v_despesa FROM _molde;
  INSERT INTO _criadas VALUES (v_despesa);

  v_saldo := pg_temp.saldo_do_teste(v_banco);

  v_resultado := public.baixar_transacao_pendente(
    v_despesa, now(), v_banco, 'PIX', NULL, NULL, NULL, 300.00, NULL
  );
  INSERT INTO _criadas VALUES ((v_resultado->>'baixa_id')::bigint);

  SELECT * INTO v_tx FROM public.transacao WHERE id = v_despesa;

  IF v_tx.pendente = true AND v_tx.valor_baixado = 300.00
     AND pg_temp.saldo_do_teste(v_banco) = v_saldo - 300.00 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 11: a pagar tambem aceita parcial, e a conta caiu R$ 300,00';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 11: pendente=%, baixado=%, conta=%',
      v_tx.pendente, v_tx.valor_baixado, pg_temp.saldo_do_teste(v_banco);
  END IF;

  /* ---------------- 8. o documento continua fechando ---------------- */
  -- Um titulo de OS pago pela metade: o documento tem que ver metade recebida e
  -- metade ainda comprometida, e a soma nao pode mudar.

  DECLARE
    v_os integer;
    v_livre numeric(14,2);
    v_titulo_os bigint;
    v_recebido numeric(14,2);
    v_comprometido numeric(14,2);
    v_quantidade bigint;
  BEGIN
    -- Uma OS que ainda tenha saldo para receber titulo, posta em PAGAMENTO para
    -- o gatilho de `os_pagamento_antecipado` aceitar. O ROLLBACK devolve tudo.
    FOR v_os IN
      SELECT o.id FROM public.ordemservico o
       WHERE coalesce(o.is_deleted, false) = false
         AND coalesce(o.orcamentototal, 0) > 0
       ORDER BY o.id
    LOOP
      UPDATE public.ordemservico
         SET status = 'PAGAMENTO'::public.enum_status_os
       WHERE id = v_os;

      SELECT saldo_disponivel_lancamento INTO v_livre
        FROM public.resumo_financeiro_os(v_os);

      EXIT WHEN coalesce(v_livre, 0) >= 100.00;
      v_os := NULL;
    END LOOP;

    IF v_os IS NULL THEN
      RAISE NOTICE 'PULOU 12: nenhuma OS com saldo livre no banco de teste';
    ELSE

      UPDATE _molde SET
        id = nextval(pg_get_serial_sequence('public.transacao','id')),
        tipo = 'RECEITA'::public.tipos_transacao,
        ordemservicoid = v_os,
        valor = 100.00, valor_base = 100.00, "valorLiquido" = 100.00,
        valor_baixado = 0, baixa_de_transacao_id = NULL, pendente = true,
        banco_id = NULL, pago_em = NULL,
        descricao = 'TESTE PARCIAL EM TITULO DE OS';
      INSERT INTO public.transacao SELECT * FROM _molde;
      SELECT id INTO v_titulo_os FROM _molde;
      INSERT INTO _criadas VALUES (v_titulo_os);

      SELECT valor_recebido, valor_comprometido, quantidade_transacoes
        INTO v_recebido, v_comprometido, v_quantidade
        FROM public.resumo_financeiro_os(v_os);

      v_resultado := public.baixar_transacao_pendente(
        v_titulo_os, now(), v_banco, 'PIX', NULL, NULL, NULL, 40.00, NULL
      );
      INSERT INTO _criadas VALUES ((v_resultado->>'baixa_id')::bigint);

      DECLARE
        v_recebido2 numeric(14,2);
        v_comprometido2 numeric(14,2);
        v_quantidade2 bigint;
      BEGIN
        SELECT valor_recebido, valor_comprometido, quantidade_transacoes
          INTO v_recebido2, v_comprometido2, v_quantidade2
          FROM public.resumo_financeiro_os(v_os);

        IF round(v_recebido2 - v_recebido, 2) = 40.00
           AND round(v_comprometido2 - v_comprometido, 2) = 0.00
           AND v_quantidade2 = v_quantidade THEN
          v_ok := v_ok + 1;
          RAISE NOTICE 'OK 12: a OS viu R$ 40,00 recebidos, o comprometido nao mudou e o titulo conta uma vez';
        ELSE
          v_falhou := v_falhou + 1;
          RAISE NOTICE 'FALHOU 12: recebido +%, comprometido +%, quantidade % -> %',
            round(v_recebido2 - v_recebido, 2), round(v_comprometido2 - v_comprometido, 2),
            v_quantidade, v_quantidade2;
        END IF;
      END;
    END IF;
  END;

  /* ---------------- 9. titulo EM ABERTO que ja tem banco previsto --------- */
  -- Foi isto que quebrou na primeira tentativa de uso: o titulo #245 do banco de
  -- demonstracao estava em aberto, com a conta prevista preenchida no lancamento,
  -- e a trava leu "tem banco" como "ja foi baixado de uma vez". Banco em titulo
  -- em aberto e previsao, nao dinheiro.

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    tipo = 'RECEITA'::public.tipos_transacao,
    ordemservicoid = NULL, vendaid = NULL,
    valor = 100.00, valor_base = 100.00, "valorLiquido" = 96.66,
    valor_acrescimos = 0, valor_descontos = 3.34,
    valor_baixado = 0, baixa_de_transacao_id = NULL, pendente = true,
    banco_id = v_banco, pago_em = NULL,
    descricao = 'TESTE TITULO EM ABERTO COM BANCO PREVISTO';
  INSERT INTO public.transacao SELECT * FROM _molde;
  SELECT id INTO v_com_banco FROM _molde;
  INSERT INTO _criadas VALUES (v_com_banco);

  v_saldo := pg_temp.saldo_do_teste(v_banco);

  BEGIN
    v_resultado := public.baixar_transacao_pendente(
      v_com_banco, now(), v_banco, 'PIX', NULL, NULL, NULL, 40.00, NULL
    );
    v_filha_banco := (v_resultado->>'baixa_id')::bigint;
    INSERT INTO _criadas VALUES (v_filha_banco);

    SELECT * INTO v_tx FROM public.transacao WHERE id = v_com_banco;

    IF v_tx.pendente = true AND v_tx.valor_baixado = 40.00
       -- o banco previsto sai: o dinheiro passa a morar nas baixas
       AND v_tx.banco_id IS NULL
       AND pg_temp.saldo_do_teste(v_banco) = v_saldo + 40.00 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 14: titulo em aberto com banco previsto aceita baixa parcial';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 14: pendente=%, baixado=%, banco=%, conta=%',
        v_tx.pendente, v_tx.valor_baixado, v_tx.banco_id, pg_temp.saldo_do_teste(v_banco);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 14: recusou a baixa parcial: %', sqlerrm;
  END;

  -- E o titulo fecha sem carregar banco, para o extrato nao somar ele e as
  -- baixas dele. O saldo restante e 96,66 - 40 = 56,66.
  BEGIN
    v_resultado := public.baixar_transacao_pendente(
      v_com_banco, now(), v_banco, 'PIX', NULL, NULL, NULL, 56.66, NULL
    );
    INSERT INTO _criadas VALUES ((v_resultado->>'baixa_id')::bigint);

    SELECT * INTO v_tx FROM public.transacao WHERE id = v_com_banco;
    IF v_tx.pendente = false AND v_tx.banco_id IS NULL AND v_tx.valor_baixado = 96.66 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 15: fechou pelas parciais, sem banco no titulo';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 15: pendente=%, banco=%, baixado=%',
        v_tx.pendente, v_tx.banco_id, v_tx.valor_baixado;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 15: nao fechou: %', sqlerrm;
  END;

  -- A trava original continua valendo onde ela nasceu: titulo LIQUIDADO com banco.
  BEGIN
    INSERT INTO public.transacao (
      descricao, valor, valor_base, "valorLiquido", data, vencimento_em, pago_em,
      tipo, pendente, banco_id, metodopagamento, categoria_id,
      baixa_de_transacao_id
    ) VALUES (
      'TESTE FILHA INVALIDA', 10, 10, 10, now(), now(), now(),
      'RECEITA'::public.tipos_transacao, false, v_banco, 'PIX'::public.metodo_pagamento,
      (SELECT categoria_id FROM _molde), v_comum
    );
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 16: aceitou baixa parcial em titulo ja baixado de uma vez';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm ILIKE '%ja foi baixado de uma vez%' OR sqlerrm ILIKE '%já foi baixado de uma vez%' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 16: a trava segue barrando o titulo liquidado com banco';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 16: barrou com outra mensagem: %', sqlerrm;
    END IF;
  END;

  /* ---------------- 10. a data de liquidacao ------------------------------ */
  -- `data` e a data de liquidacao, e e por ela que as listas e os KPIs recortam o
  -- periodo. Dois titulos quitados no mesmo dia tem que cair no mesmo mes, tendo
  -- sido pagos de uma vez ou em partes.

  DECLARE
    v_dt bigint;
    v_dt_comum bigint;
    v_ultima bigint;
  BEGIN
    UPDATE _molde SET
      id = nextval(pg_get_serial_sequence('public.transacao','id')),
      tipo = 'RECEITA'::public.tipos_transacao, ordemservicoid = NULL, vendaid = NULL,
      valor = 1000.00, valor_base = 1000.00, "valorLiquido" = 1000.00,
      valor_acrescimos = 0, valor_descontos = 0,
      valor_baixado = 0, baixa_de_transacao_id = NULL, pendente = true,
      banco_id = NULL, pago_em = NULL,
      vencimento_em = '2026-07-10'::timestamptz, data = '2026-07-10'::timestamptz,
      descricao = 'TESTE DATA POR PARCIAIS';
    INSERT INTO public.transacao SELECT * FROM _molde;
    SELECT id INTO v_dt FROM _molde;
    INSERT INTO _criadas VALUES (v_dt);

    v_resultado := public.baixar_transacao_pendente(
      v_dt, '2026-08-05'::timestamptz, v_banco, 'PIX', NULL, NULL, NULL, 400.00, NULL);
    INSERT INTO _criadas VALUES ((v_resultado->>'baixa_id')::bigint);

    SELECT * INTO v_tx FROM public.transacao WHERE id = v_dt;
    IF v_tx.data::date = '2026-07-10' AND v_tx.pago_em IS NULL THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 17: em aberto, o titulo segue valendo pelo vencimento';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 17: data=% pago=%', v_tx.data, v_tx.pago_em;
    END IF;

    v_resultado := public.baixar_transacao_pendente(
      v_dt, '2026-08-19'::timestamptz, v_banco, 'PIX', NULL, NULL, NULL, 600.00, NULL);
    v_ultima := (v_resultado->>'baixa_id')::bigint;
    INSERT INTO _criadas VALUES (v_ultima);

    SELECT * INTO v_tx FROM public.transacao WHERE id = v_dt;

    -- o mesmo titulo, baixado de uma vez no mesmo dia, para comparar
    UPDATE _molde SET
      id = nextval(pg_get_serial_sequence('public.transacao','id')),
      valor_baixado = 0, baixa_de_transacao_id = NULL, pendente = true,
      banco_id = NULL, pago_em = NULL,
      vencimento_em = '2026-07-10'::timestamptz, data = '2026-07-10'::timestamptz,
      descricao = 'TESTE DATA DE UMA VEZ';
    INSERT INTO public.transacao SELECT * FROM _molde;
    SELECT id INTO v_dt_comum FROM _molde;
    INSERT INTO _criadas VALUES (v_dt_comum);
    PERFORM public.baixar_transacao_pendente(
      v_dt_comum, '2026-08-19'::timestamptz, v_banco, 'PIX', NULL, NULL, NULL, NULL, NULL);

    IF v_tx.data::date = '2026-08-19' AND v_tx.pago_em::date = '2026-08-19'
       AND v_tx.data::date = (SELECT data::date FROM public.transacao WHERE id = v_dt_comum) THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 18: fechado por parciais cai no mesmo dia do baixado de uma vez';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 18: parciais data=% vs de uma vez data=%',
        v_tx.data, (SELECT data FROM public.transacao WHERE id = v_dt_comum);
    END IF;

    -- reabrir devolve a data ao vencimento
    PERFORM public.estornar_baixa_transacao(v_ultima, NULL);
    SELECT * INTO v_tx FROM public.transacao WHERE id = v_dt;
    IF v_tx.pendente = true AND v_tx.data::date = '2026-07-10' AND v_tx.pago_em IS NULL THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 19: o estorno devolveu a data ao vencimento';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 19: data=% pago=% pendente=%', v_tx.data, v_tx.pago_em, v_tx.pendente;
    END IF;
  END;

  /* ---------------- 11. terminar de receber SEM informar o valor ---------- */
  -- Foi o caso do titulo #382 no Demir: R$ 758,65 com uma parcial de R$ 37,57.
  -- Marcar o restante como pago mandava p_valor nulo — a tela so mandava valor
  -- quando era MENOS que o saldo, e o lote nunca manda —, e nulo significava
  -- "baixa de uma vez", que grava banco no titulo. Num titulo que ja tem filhas
  -- isso e o que a trava proibe, e a baixa era recusada.

  DECLARE
    v_r bigint;
    v_saldo_antes numeric(14,2);
  BEGIN
    UPDATE _molde SET
      id = nextval(pg_get_serial_sequence('public.transacao','id')),
      tipo = 'RECEITA'::public.tipos_transacao, ordemservicoid = NULL, vendaid = NULL,
      valor = 758.65, valor_base = 758.65, "valorLiquido" = 758.65,
      valor_acrescimos = 0, valor_descontos = 0,
      valor_baixado = 0, baixa_de_transacao_id = NULL, pendente = true,
      banco_id = NULL, pago_em = NULL,
      vencimento_em = date_trunc('day', now()), data = date_trunc('day', now()),
      descricao = 'TESTE RESTANTE SEM VALOR';
    INSERT INTO public.transacao SELECT * FROM _molde;
    SELECT id INTO v_r FROM _molde;
    INSERT INTO _criadas VALUES (v_r);

    v_resultado := public.baixar_transacao_pendente(
      v_r, now(), v_banco, 'PIX', NULL, NULL, NULL, 37.57, NULL);
    INSERT INTO _criadas VALUES ((v_resultado->>'baixa_id')::bigint);

    v_saldo_antes := pg_temp.saldo_do_teste(v_banco);

    -- p_valor NULO, como a tela e o lote mandavam
    BEGIN
      v_resultado := public.baixar_transacao_pendente(
        v_r, now(), v_banco, 'PIX', NULL, NULL, NULL, NULL, NULL);
      INSERT INTO _criadas VALUES ((v_resultado->>'baixa_id')::bigint);

      SELECT * INTO v_tx FROM public.transacao WHERE id = v_r;

      IF v_tx.pendente = false AND v_tx.banco_id IS NULL
         AND v_tx.valor_baixado = 758.65
         AND pg_temp.saldo_do_teste(v_banco) = v_saldo_antes + 721.08 THEN
        v_ok := v_ok + 1;
        RAISE NOTICE 'OK 20: p_valor nulo terminou de receber pelo caminho da filha';
      ELSE
        v_falhou := v_falhou + 1;
        RAISE NOTICE 'FALHOU 20: pendente=% banco=% baixado=% conta=%',
          v_tx.pendente, v_tx.banco_id, v_tx.valor_baixado, pg_temp.saldo_do_teste(v_banco);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 20: recusou terminar de receber: %', sqlerrm;
    END;

    -- e o titulo SEM filhas segue baixando de uma vez, com banco nele
    UPDATE _molde SET
      id = nextval(pg_get_serial_sequence('public.transacao','id')),
      valor = 200.00, valor_base = 200.00, "valorLiquido" = 200.00,
      valor_baixado = 0, baixa_de_transacao_id = NULL, pendente = true,
      banco_id = NULL, pago_em = NULL, descricao = 'TESTE SEM FILHAS SEGUE IGUAL';
    INSERT INTO public.transacao SELECT * FROM _molde;
    SELECT id INTO v_r FROM _molde;
    INSERT INTO _criadas VALUES (v_r);

    PERFORM public.baixar_transacao_pendente(
      v_r, now(), v_banco, 'PIX', NULL, NULL, NULL, NULL, NULL);
    SELECT * INTO v_tx FROM public.transacao WHERE id = v_r;

    IF v_tx.banco_id = v_banco AND v_tx.valor_baixado = 0
       AND NOT EXISTS (SELECT 1 FROM public.transacao WHERE baixa_de_transacao_id = v_r) THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 21: sem filhas, p_valor nulo segue sendo a baixa de uma vez';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 21: banco=% baixado=%', v_tx.banco_id, v_tx.valor_baixado;
    END IF;
  END;

  /* ---------------- 12. a filha nao vira receita nova na DRE --------------- */

  SELECT count(*) INTO v_n
    FROM public.eventos_financeiros
   WHERE source_type = 'TRANSACAO' AND source_id = v_filha1 AND status = 'ATIVO';
  IF v_n = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 13: a baixa parcial nao criou evento de resultado';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 13: a baixa parcial virou receita na DRE';
  END IF;

  RAISE NOTICE '---';
  RAISE NOTICE '=== % passaram, % falharam ===', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Ha % verificacoes falhando.', v_falhou;
  END IF;
END $t$;

ROLLBACK;
