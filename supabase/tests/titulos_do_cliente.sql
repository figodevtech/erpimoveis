-- Teste da view public.transacao_cliente e das funcoes titulos_do_cliente /
-- clientes_divida contra um banco real (demo).
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/titulos_do_cliente.sql
--
-- Tudo dentro de uma transacao que termina em ROLLBACK: as linhas de teste
-- somem no fim. Nada e escrito no banco.
--
-- As linhas sao clonadas de uma transacao existente (tabela temporaria
-- `_molde`), entao o script nao precisa conhecer as colunas NOT NULL da
-- `transacao` — se um dia ela ganhar mais uma, ele continua funcionando.
--
-- O que este teste protege, em ordem de importancia:
--   1. titulo avulso/migrado com cliente_id ENTRA na divida do cliente (o bug);
--   2. titulo sem cliente_id e sem OS/venda NAO entra em cadastro nenhum;
--   3. titulo de OS continua contando pelo cliente da OS (nada regrediu);
--   4. quando os dois existem e discordam, cliente_id vence e o titulo aparece
--      em UM dono so.

BEGIN;

DO $$
DECLARE
  v_cliente     integer;
  v_cliente_os  integer;
  v_os          integer;
  v_orfa        bigint;
  v_antes       numeric;
  v_antes_os    numeric;
  v_depois      numeric;
  v_vencido     numeric;
  v_qtd         integer;
  v_esperado    integer;
  v_migrado     boolean;
  v_ok          int := 0;
  v_falhou      int := 0;
BEGIN
  /* ---------------- pre-requisitos ---------------- */

  IF to_regclass('public.transacao_cliente') IS NULL THEN
    RAISE EXCEPTION 'A view transacao_cliente nao existe. Rode as migrations primeiro.';
  END IF;
  IF to_regprocedure('public.titulos_do_cliente(integer)') IS NULL THEN
    RAISE EXCEPTION 'A funcao titulos_do_cliente nao existe. Rode as migrations primeiro.';
  END IF;
  IF to_regprocedure('public.clientes_divida(integer[],boolean)') IS NULL THEN
    RAISE EXCEPTION 'A funcao clientes_divida nao existe. Rode as migrations primeiro.';
  END IF;

  /* ---------------- fixtures ---------------- */

  -- Uma OS com cliente, para o caminho "dono vem da OS".
  --
  -- Precisa de saldo livre: outro gatilho recusa titulo que faca a soma passar
  -- do total financeiro da OS. Os dois titulos de teste somam R$ 281,00.
  SELECT o.id, o.clienteid INTO v_os, v_cliente_os
    FROM public.ordemservico o
   WHERE o.clienteid IS NOT NULL
     AND coalesce(o.is_deleted, false) = false
     AND coalesce(o.orcamentototal, 0) >= 300
     AND NOT EXISTS (
       SELECT 1 FROM public.transacao t
        WHERE t.ordemservicoid = o.id
          AND t.is_deleted = false
          AND upper(t.tipo::text) = 'RECEITA'
     )
   ORDER BY
     -- Prefere uma que ja aceite pagamento; so promove se nao houver nenhuma.
     CASE WHEN o.status::text IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO')
          THEN 0 ELSE 1 END,
     coalesce(o.orcamentototal, 0) DESC
   LIMIT 1;

  IF v_os IS NULL THEN
    RAISE EXCEPTION 'Nenhuma OS com cliente, sem pagamentos e com saldo >= 300 para servir de fixture.';
  END IF;

  -- O gatilho de 20260809180000_os_pagamento_antecipado so aceita receita em OS
  -- aprovada e ainda nao concluida. Bancos de teste costumam ter so OS
  -- concluida ou em orcamento, entao a OS e promovida aqui dentro — o ROLLBACK
  -- desfaz. Montar o fluxo completo da OS seria testar a OS, nao a view.
  UPDATE public.ordemservico
     SET status = 'EM_ANDAMENTO'
   WHERE id = v_os
     AND status::text NOT IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO');

  -- Um cliente DIFERENTE do dono da OS, para o teste de precedencia.
  SELECT c.id INTO v_cliente
    FROM public.cliente c
   WHERE c.is_deleted = false AND c.id <> v_cliente_os
   LIMIT 1;

  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'Nenhum segundo cliente para servir de fixture.';
  END IF;

  CREATE TEMP TABLE _molde ON COMMIT DROP AS
    SELECT * FROM public.transacao
     WHERE is_deleted = false AND upper(tipo::text) = 'RECEITA'
     LIMIT 1;

  IF (SELECT count(*) FROM _molde) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma transacao de RECEITA para servir de molde.';
  END IF;

  -- Zera o que nao pode vazar do molde para as linhas de teste.
  UPDATE _molde SET
    ordemservicoid = NULL, vendaid = NULL, entrada_id = NULL,
    usoconsumo_entrada_id = NULL, evento_financeiro_id = NULL,
    estorno_transacao_id = NULL, is_deleted = false,
    cliente_id = NULL, fornecedor_id = NULL,
    valor_acrescimos = 0, valor_baixado = 0, pago_em = NULL,
    origem = 'ERP', descricao = 'TESTE TITULOS DO CLIENTE';

  /* ---------------- medicao inicial ---------------- */

  SELECT COALESCE(sum(total_em_aberto), 0) INTO v_antes
    FROM public.clientes_divida(ARRAY[v_cliente], false);

  SELECT COALESCE(sum(total_em_aberto), 0) INTO v_antes_os
    FROM public.clientes_divida(ARRAY[v_cliente_os], false);

  /* ---------------- 1. titulo migrado com cliente_id ---------------- */
  -- O bug original: sem OS e sem venda, era invisivel no cadastro.

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    cliente_id = v_cliente, pendente = true, origem = 'ORIGEM_MIGRACAO',
    valor = 1000.00, "valorLiquido" = 1000.00,
    data = now() - interval '40 days',
    vencimento_em = now() - interval '10 days',
    descricao = 'TESTE - migrado vencido';
  INSERT INTO public.transacao SELECT * FROM _molde;

  SELECT total_em_aberto, total_vencido, tem_migrado
    INTO v_depois, v_vencido, v_migrado
    FROM public.clientes_divida(ARRAY[v_cliente], false);

  IF COALESCE(v_depois, 0) - v_antes = 1000.00 THEN
    v_ok := v_ok + 1;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 1a: em aberto subiu %, esperado 1000.00',
      COALESCE(v_depois, 0) - v_antes;
  END IF;

  IF COALESCE(v_vencido, 0) >= 1000.00 AND v_migrado THEN
    v_ok := v_ok + 1;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 1b: vencido=% migrado=%', v_vencido, v_migrado;
  END IF;

  /* ---------------- 2. baixa parcial reduz o em aberto ---------------- */

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    cliente_id = v_cliente, pendente = true, origem = 'ERP',
    valor = 500.00, "valorLiquido" = 500.00, valor_baixado = 200.00,
    data = now() + interval '20 days',
    vencimento_em = now() + interval '20 days',
    descricao = 'TESTE - parcial a vencer';
  INSERT INTO public.transacao SELECT * FROM _molde;

  SELECT total_em_aberto INTO v_depois
    FROM public.clientes_divida(ARRAY[v_cliente], false);

  -- 1000 do primeiro + 300 (500 - 200) do segundo.
  IF COALESCE(v_depois, 0) - v_antes = 1300.00 THEN
    v_ok := v_ok + 1;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 2: em aberto subiu %, esperado 1300.00',
      COALESCE(v_depois, 0) - v_antes;
  END IF;

  /* ---------------- 3. orfa nao entra em cadastro nenhum ---------------- */
  -- A garantia central: dado que nao bate nao vira vinculo.

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    cliente_id = NULL, ordemservicoid = NULL, vendaid = NULL,
    pendente = true, origem = 'ORIGEM_MIGRACAO',
    valor = 7777.00, "valorLiquido" = 7777.00, valor_baixado = 0,
    data = now() - interval '5 days',
    vencimento_em = now() - interval '5 days',
    descricao = 'TESTE - orfa sem documento';
  INSERT INTO public.transacao SELECT * FROM _molde RETURNING id INTO v_orfa;

  IF NOT EXISTS (
    SELECT 1 FROM public.transacao_cliente tc
     WHERE tc.transacao_id = v_orfa AND tc.cliente_id IS NOT NULL
  ) THEN
    v_ok := v_ok + 1;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 3a: a orfa ganhou dono na view';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.clientes_divida(NULL, false) d
     WHERE d.cliente_id IN (v_cliente, v_cliente_os)
       AND d.total_em_aberto >= 7777.00
  ) THEN
    v_ok := v_ok + 1;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 3b: a orfa entrou na divida de alguem';
  END IF;

  /* ---------------- 4. titulo de OS conta pelo cliente da OS ---------------- */
  -- Comportamento de antes, que nao pode ter regredido.

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    cliente_id = NULL, ordemservicoid = v_os,
    pendente = true, origem = 'ERP',
    valor = 250.00, "valorLiquido" = 250.00, valor_baixado = 0,
    data = now() - interval '3 days',
    vencimento_em = now() - interval '3 days',
    descricao = 'TESTE - titulo de OS';
  INSERT INTO public.transacao SELECT * FROM _molde;

  SELECT total_em_aberto INTO v_depois
    FROM public.clientes_divida(ARRAY[v_cliente_os], false);

  IF COALESCE(v_depois, 0) - v_antes_os = 250.00 THEN
    v_ok := v_ok + 1;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 4: OS subiu %, esperado 250.00',
      COALESCE(v_depois, 0) - v_antes_os;
  END IF;

  /* ---------------- 5. precedencia: cliente_id vence a OS ---------------- */
  -- E o titulo aparece em UM dono so, nunca nos dois.

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    cliente_id = v_cliente, ordemservicoid = v_os,
    pendente = true, origem = 'ERP',
    valor = 31.00, "valorLiquido" = 31.00,
    data = now() - interval '2 days',
    vencimento_em = now() - interval '2 days',
    descricao = 'TESTE - cliente_id discorda da OS';
  INSERT INTO public.transacao SELECT * FROM _molde;

  SELECT total_em_aberto INTO v_depois
    FROM public.clientes_divida(ARRAY[v_cliente], false);
  IF COALESCE(v_depois, 0) - v_antes = 1331.00 THEN
    v_ok := v_ok + 1;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 5a: cliente_id nao venceu; subiu %, esperado 1331.00',
      COALESCE(v_depois, 0) - v_antes;
  END IF;

  SELECT total_em_aberto INTO v_depois
    FROM public.clientes_divida(ARRAY[v_cliente_os], false);
  IF COALESCE(v_depois, 0) - v_antes_os = 250.00 THEN
    v_ok := v_ok + 1;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 5b: o titulo vazou para o cliente da OS; subiu %, esperado 250.00',
      COALESCE(v_depois, 0) - v_antes_os;
  END IF;

  /* ---------------- 6. titulos_do_cliente cobre a view inteira ---------------- */

  SELECT count(*) INTO v_qtd FROM public.titulos_do_cliente(v_cliente);
  SELECT count(*) INTO v_esperado
    FROM public.transacao_cliente tc WHERE tc.cliente_id = v_cliente;

  IF v_qtd = v_esperado THEN
    v_ok := v_ok + 1;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 6: titulos_do_cliente devolveu %, a view tem %',
      v_qtd, v_esperado;
  END IF;

  /* ---------------- 7. filtro de devedores ---------------- */

  IF EXISTS (SELECT 1 FROM public.clientes_divida(ARRAY[v_cliente], true)) THEN
    v_ok := v_ok + 1;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 7a: cliente com titulo vencido ficou fora do filtro';
  END IF;

  -- Tirando os dois vencidos de teste, sobra so o titulo a vencer. Se o cliente
  -- nao tinha vencido antes, ele deixa de ser devedor.
  UPDATE public.transacao SET is_deleted = true
   WHERE descricao IN ('TESTE - migrado vencido', 'TESTE - cliente_id discorda da OS');

  SELECT COALESCE(sum(total_vencido), 0) INTO v_vencido
    FROM public.clientes_divida(ARRAY[v_cliente], false);

  IF v_vencido > 0
     OR NOT EXISTS (SELECT 1 FROM public.clientes_divida(ARRAY[v_cliente], true)) THEN
    v_ok := v_ok + 1;
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 7b: cliente so com titulo a vencer apareceu como devedor';
  END IF;

  /* ---------------- resultado ---------------- */

  RAISE NOTICE '';
  RAISE NOTICE '================================';
  RAISE NOTICE 'OK: %  FALHOU: %', v_ok, v_falhou;
  RAISE NOTICE '================================';

  IF v_falhou > 0 THEN
    RAISE EXCEPTION '% verificacao(oes) falharam.', v_falhou;
  END IF;
END
$$;

ROLLBACK;
