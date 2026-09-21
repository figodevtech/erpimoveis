-- Vínculo de NFS-e com serviços de várias OS (20260921130000).
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/nfse_os_agrupada.sql
--   npm run db:test:sql -- supabase/tests/nfse_os_agrupada.sql demir
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito.

BEGIN;

DO $teste$
DECLARE
  v_cliente_a   integer;
  v_cliente_b   integer;
  v_servico_1   integer;
  v_servico_2   integer;
  v_os_a        integer;
  v_os_b        integer;
  v_os_outra    integer;
  v_nfse_1      bigint;
  v_nfse_2      bigint;
  v_qtd         integer;
  v_texto       text;
  v_cols        text;
  v_ok          integer := 0;
  v_falhou      integer := 0;
BEGIN
  /* ---------------- pré-requisitos ---------------- */

  IF to_regclass('public.nfse_os_servico_vinculo') IS NULL THEN
    RAISE EXCEPTION 'A tabela nfse_os_servico_vinculo não existe. Rode as migrations primeiro.';
  END IF;

  IF to_regprocedure('public.vincular_nfse_os(bigint,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'A função vincular_nfse_os não existe. Rode as migrations primeiro.';
  END IF;

  SELECT id INTO v_cliente_a FROM public.cliente ORDER BY id LIMIT 1;
  SELECT id INTO v_cliente_b FROM public.cliente WHERE id <> v_cliente_a ORDER BY id LIMIT 1;
  IF v_cliente_a IS NULL OR v_cliente_b IS NULL THEN
    RAISE EXCEPTION 'O banco precisa de ao menos dois clientes para este teste.';
  END IF;

  SELECT id INTO v_servico_1 FROM public.servico ORDER BY id LIMIT 1;
  SELECT id INTO v_servico_2 FROM public.servico WHERE id <> v_servico_1 ORDER BY id LIMIT 1;
  IF v_servico_1 IS NULL OR v_servico_2 IS NULL THEN
    RAISE EXCEPTION 'O banco precisa de ao menos dois serviços para este teste.';
  END IF;

  /* ---------------- moldes ---------------- */

  CREATE TEMP TABLE _molde_os_nfse ON COMMIT DROP AS
    SELECT * FROM public.ordemservico ORDER BY id LIMIT 1;

  CREATE TEMP TABLE _molde_nfse ON COMMIT DROP AS
    SELECT * FROM public.nfse ORDER BY id LIMIT 1;

  IF (SELECT count(*) FROM _molde_nfse) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma NFS-e para servir de molde.';
  END IF;

  -- `status` sai do molde da OS: clonar uma OS concluída dispara guardas de
  -- negócio que não têm relação com este teste.
  FOR v_texto IN
    SELECT a.attname FROM pg_attribute a
     WHERE a.attrelid = '_molde_os_nfse'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND (a.attname IN ('id', 'status')
            OR a.attname IN (SELECT b.attname FROM pg_attribute b
                              WHERE b.attrelid = 'public.ordemservico'::regclass AND b.attgenerated <> ''))
  LOOP
    EXECUTE format('ALTER TABLE _molde_os_nfse DROP COLUMN %I', v_texto);
  END LOOP;

  -- `referencia` é UNIQUE; o clone precisa da sua.
  FOR v_texto IN
    SELECT a.attname FROM pg_attribute a
     WHERE a.attrelid = '_molde_nfse'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND (a.attname IN ('id', 'referencia')
            OR a.attname IN (SELECT b.attname FROM pg_attribute b
                              WHERE b.attrelid = 'public.nfse'::regclass AND b.attgenerated <> ''))
  LOOP
    EXECUTE format('ALTER TABLE _molde_nfse DROP COLUMN %I', v_texto);
  END LOOP;

  /* ---------------- três OS com os mesmos dois serviços ---------------- */

  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_cols
    FROM pg_attribute
   WHERE attrelid = '_molde_os_nfse'::regclass AND attnum > 0 AND NOT attisdropped;

  EXECUTE format(
    'INSERT INTO public.ordemservico (%s, status) SELECT %s, ''ORCAMENTO'' FROM _molde_os_nfse RETURNING id',
    v_cols, v_cols) INTO v_os_a;
  EXECUTE format(
    'INSERT INTO public.ordemservico (%s, status) SELECT %s, ''ORCAMENTO'' FROM _molde_os_nfse RETURNING id',
    v_cols, v_cols) INTO v_os_b;
  EXECUTE format(
    'INSERT INTO public.ordemservico (%s, status) SELECT %s, ''ORCAMENTO'' FROM _molde_os_nfse RETURNING id',
    v_cols, v_cols) INTO v_os_outra;

  UPDATE public.ordemservico SET clienteid = v_cliente_a WHERE id IN (v_os_a, v_os_b);
  UPDATE public.ordemservico SET clienteid = v_cliente_b WHERE id = v_os_outra;

  INSERT INTO public.osservico (ordemservicoid, servicoid, quantidade, precounitario, subtotal)
  VALUES (v_os_a, v_servico_1, 1, 100, 100),
         (v_os_a, v_servico_2, 1, 100, 100),
         (v_os_b, v_servico_1, 1, 100, 100),
         (v_os_outra, v_servico_1, 1, 100, 100)
  ON CONFLICT DO NOTHING;

  /* ---------------- duas NFS-e em processamento ---------------- */

  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_cols
    FROM pg_attribute
   WHERE attrelid = '_molde_nfse'::regclass AND attnum > 0 AND NOT attisdropped;

  EXECUTE format(
    'INSERT INTO public.nfse (%s, referencia) SELECT %s, ''TESTE_'' || md5(random()::text) FROM _molde_nfse RETURNING id',
    v_cols, v_cols) INTO v_nfse_1;
  EXECUTE format(
    'INSERT INTO public.nfse (%s, referencia) SELECT %s, ''TESTE_'' || md5(random()::text) FROM _molde_nfse RETURNING id',
    v_cols, v_cols) INTO v_nfse_2;

  UPDATE public.nfse
     SET status = 'PROCESSANDO', clienteid = v_cliente_a, ordemservicoid = v_os_a
   WHERE id = v_nfse_1;
  UPDATE public.nfse
     SET status = 'PROCESSANDO', clienteid = v_cliente_a, ordemservicoid = v_os_b
   WHERE id = v_nfse_2;

  /* ====== 1. serviços de duas OS do mesmo cliente numa NFS-e só ====== */

  PERFORM public.vincular_nfse_os(
    v_nfse_1,
    jsonb_build_array(
      jsonb_build_object('ordemservico_id', v_os_a, 'servico_id', v_servico_1),
      jsonb_build_object('ordemservico_id', v_os_a, 'servico_id', v_servico_2),
      jsonb_build_object('ordemservico_id', v_os_b, 'servico_id', v_servico_1)
    )
  );

  SELECT count(*) INTO v_qtd FROM public.nfse_os_servico_vinculo WHERE nfse_id = v_nfse_1;
  IF v_qtd = 3 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: tres servicos de duas OS agrupados numa NFS-e.';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 1: esperava 3 vinculos, veio %.', v_qtd;
  END IF;

  SELECT count(*) INTO v_qtd
    FROM public.nfse_os_servico_vinculo
   WHERE nfse_id = v_nfse_1 AND ancora AND ordemservico_id = v_os_a;
  IF v_qtd = 2 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: a ancora foi derivada da coluna escalar da nota.';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 2: ancora nao marcada nos servicos da OS %.', v_os_a;
  END IF;

  /* ====== 3. serviço já ocupado é recusado ====== */

  BEGIN
    PERFORM public.vincular_nfse_os(
      v_nfse_2,
      jsonb_build_array(
        jsonb_build_object('ordemservico_id', v_os_b, 'servico_id', v_servico_1)
      )
    );
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 3: a segunda nota tomou um servico ja ocupado.';
  EXCEPTION
    WHEN unique_violation THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 3: servico ocupado por outra nota viva foi recusado (23505).';
  END;

  /* ====== 4. rejeitar a primeira libera os serviços ====== */

  UPDATE public.nfse SET status = 'REJEITADA' WHERE id = v_nfse_1;

  SELECT count(*) INTO v_qtd
    FROM public.nfse_os_servico_vinculo WHERE nfse_id = v_nfse_1 AND ativo;
  IF v_qtd = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 4: rejeitar a nota liberou os servicos.';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 4: % vinculo(s) seguiram ativos apos a rejeicao.', v_qtd;
  END IF;

  BEGIN
    PERFORM public.vincular_nfse_os(
      v_nfse_2,
      jsonb_build_array(
        jsonb_build_object('ordemservico_id', v_os_b, 'servico_id', v_servico_1)
      )
    );
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 5: com a anterior rejeitada, o servico voltou a ser emitivel.';
  EXCEPTION
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE WARNING 'FALHOU 5: servico liberado continuou bloqueado (%).', SQLERRM;
  END;

  /* ====== 6. OS de outro cliente é recusada ====== */

  BEGIN
    PERFORM public.vincular_nfse_os(
      v_nfse_2,
      jsonb_build_array(
        jsonb_build_object('ordemservico_id', v_os_b, 'servico_id', v_servico_1),
        jsonb_build_object('ordemservico_id', v_os_outra, 'servico_id', v_servico_1)
      )
    );
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 6: aceitou agrupar OS de cliente diferente.';
  EXCEPTION
    WHEN check_violation THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 6: OS de outro cliente recusada — tomador unico.';
  END;

  /* ====== 7. serviço que não pertence à OS é recusado ====== */

  BEGIN
    PERFORM public.vincular_nfse_os(
      v_nfse_2,
      jsonb_build_array(
        jsonb_build_object('ordemservico_id', v_os_b, 'servico_id', v_servico_1),
        jsonb_build_object('ordemservico_id', v_os_b, 'servico_id', v_servico_2)
      )
    );
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 7: aceitou um servico que nao esta na OS.';
  EXCEPTION
    WHEN check_violation THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 7: servico fora da OS recusado.';
  END;

  /* ====== 8. o grupo não pode perder a âncora ====== */

  BEGIN
    PERFORM public.vincular_nfse_os(
      v_nfse_2,
      jsonb_build_array(
        jsonb_build_object('ordemservico_id', v_os_a, 'servico_id', v_servico_2)
      )
    );
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 8: aceitou um grupo sem a OS ancora.';
  EXCEPTION
    WHEN sqlstate '22023' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 8: grupo sem a OS ancora recusado.';
  END;

  /* ---------------- resultado ---------------- */

  RAISE NOTICE '---';
  RAISE NOTICE 'Verificacoes OK: %, falhas: %', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION '% verificacao(oes) falharam.', v_falhou;
  END IF;
END;
$teste$;

ROLLBACK;
