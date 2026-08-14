-- Teste das colunas que a venda passa a mandar ao financeiro.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/venda_dados_para_financeiro.sql
--   npm run db:test:sql -- supabase/tests/venda_dados_para_financeiro.sql demir
--
-- Tudo dentro de uma transação que termina em ROLLBACK: a venda de teste some no
-- fim. Nada é escrito no banco.
--
-- A linha é clonada de uma venda existente (tabela temporária `_molde`), então o
-- script não precisa conhecer o schema: se `venda` ganhar uma coluna NOT NULL,
-- ele continua funcionando.

BEGIN;

DO $t$
DECLARE
  v_id integer;
  v_previstos jsonb := '[{"metodo":"CREDITO","valor":150.00,"parcelas":3},
                         {"metodo":"PIX","valor":50.00,"parcelas":null}]'::jsonb;
  v_lido jsonb;
  v_ok int := 0;
  v_falhou int := 0;
BEGIN
  /* ---------------- pré-requisitos ---------------- */

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'venda'
       AND column_name = 'pagamentos_previstos'
  ) THEN
    RAISE EXCEPTION 'As colunas do financeiro nao existem em venda. Rode as migrations primeiro.';
  END IF;

  /* ---------------- fixture ---------------- */

  CREATE TEMP TABLE _molde ON COMMIT DROP AS
    SELECT * FROM public.venda LIMIT 1;
  IF (SELECT count(*) FROM _molde) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma venda para servir de molde.';
  END IF;

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.venda','id')),
    forma_pagamento = 'CREDITO: R$ 150,00, PIX: R$ 50,00',
    pagamentos_previstos = v_previstos,
    descricao_financeiro = 'Cobrar a entrada na retirada',
    garantia = '90 dias para pecas e servicos',
    parcelas_pagamento = NULL;
  -- `venda.id` é GENERATED ALWAYS: sem OVERRIDING o clone não entra.
  INSERT INTO public.venda OVERRIDING SYSTEM VALUE SELECT * FROM _molde;
  SELECT id INTO v_id FROM _molde;

  /* ---------------- 1. o snapshot volta inteiro ---------------- */

  SELECT pagamentos_previstos INTO v_lido FROM public.venda WHERE id = v_id;

  IF v_lido -> 0 ->> 'metodo' = 'CREDITO'
     AND (v_lido -> 0 ->> 'parcelas')::int = 3
     AND v_lido -> 1 ->> 'metodo' = 'PIX' THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: as parcelas do credito sobreviveram (3x), que forma_pagamento nunca soube dizer';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: pagamentos_previstos voltou %', v_lido;
  END IF;

  /* ---------------- 2. garantia em branco e recusada ---------------- */

  BEGIN
    UPDATE public.venda SET garantia = '   ' WHERE id = v_id;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 2: aceitou garantia so com espacos';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: recusou garantia em branco';
  END;

  /* ---------------- 3. parcelas fora de 1..12 sao recusadas ---------------- */

  BEGIN
    UPDATE public.venda SET parcelas_pagamento = 13 WHERE id = v_id;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 3: aceitou 13 parcelas';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: recusou parcelas fora de 1..12';
  END;

  /* ---------------- 4. pagamentos_previstos tem que ser lista ---------------- */

  BEGIN
    UPDATE public.venda SET pagamentos_previstos = '{"metodo":"PIX"}'::jsonb WHERE id = v_id;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 4: aceitou objeto onde deveria haver lista';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: recusou pagamentos_previstos fora de lista';
  END;

  /* ---------------- 5. tudo nulo continua valido ---------------- */

  BEGIN
    UPDATE public.venda
       SET garantia = NULL, parcelas_pagamento = NULL,
           descricao_financeiro = NULL, pagamentos_previstos = NULL
     WHERE id = v_id;
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 5: venda sem nenhum dado do financeiro continua valida';
  EXCEPTION WHEN OTHERS THEN
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 5: %', sqlerrm;
  END;

  RAISE NOTICE '---';
  RAISE NOTICE '=== % passaram, % falharam ===', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Ha % verificacoes falhando.', v_falhou;
  END IF;
END $t$;

-- Nada acima é persistido.
ROLLBACK;
