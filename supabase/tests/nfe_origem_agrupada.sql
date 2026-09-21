-- Vínculo de NF-e com várias OS / vendas (20260921140000).
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/nfe_origem_agrupada.sql
--   npm run db:test:sql -- supabase/tests/nfe_origem_agrupada.sql demir
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito.
--
-- As linhas de teste são clonadas de registros existentes (tabelas temporárias
-- `_molde_*`), então o script não precisa conhecer o schema: se `nfe` ou
-- `ordemservico` ganharem uma coluna NOT NULL, ele continua funcionando.

BEGIN;

DO $teste$
DECLARE
  v_cliente_a   integer;
  v_cliente_b   integer;
  v_os_a        integer;
  v_os_b        integer;
  v_os_outra    integer;
  v_nfe_1       bigint;
  v_nfe_2       bigint;
  v_qtd         integer;
  v_texto       text;
  v_cols        text;
  v_ok          integer := 0;
  v_falhou      integer := 0;
BEGIN
  /* ---------------- pré-requisitos ---------------- */

  IF to_regclass('public.nfe_origem_vinculo') IS NULL THEN
    RAISE EXCEPTION 'A tabela nfe_origem_vinculo não existe. Rode as migrations primeiro.';
  END IF;

  IF to_regprocedure('public.vincular_nfe_origens(bigint,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'A função vincular_nfe_origens não existe. Rode as migrations primeiro.';
  END IF;

  IF to_regprocedure('public.nfe_status_ocupa_origem(text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'A função nfe_status_ocupa_origem não existe. Rode as migrations primeiro.';
  END IF;

  /* ---------------- moldes ---------------- */

  SELECT id INTO v_cliente_a FROM public.cliente ORDER BY id LIMIT 1;
  SELECT id INTO v_cliente_b FROM public.cliente WHERE id <> v_cliente_a ORDER BY id LIMIT 1;

  IF v_cliente_a IS NULL OR v_cliente_b IS NULL THEN
    RAISE EXCEPTION 'O banco precisa de ao menos dois clientes para este teste.';
  END IF;

  CREATE TEMP TABLE _molde_os ON COMMIT DROP AS
    SELECT * FROM public.ordemservico ORDER BY id LIMIT 1;

  IF (SELECT count(*) FROM _molde_os) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma ordem de serviço para servir de molde.';
  END IF;

  CREATE TEMP TABLE _molde_nfe ON COMMIT DROP AS
    SELECT * FROM public.nfe ORDER BY id LIMIT 1;

  IF (SELECT count(*) FROM _molde_nfe) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma NF-e para servir de molde.';
  END IF;

  -- Colunas geradas e a PK saem do molde: a primeira não aceita insert
  -- explícito, a segunda precisa vir do default para não colidir.
  --
  -- `status` sai junto e é reposto como ORCAMENTO. O vínculo de origem não
  -- olha o status da OS, mas as regras de negócio da própria OS olham: clonar
  -- uma OS concluída dispara a guarda de cobertura do faturamento em tenants
  -- que a usam, e o teste falharia por um motivo que não é o dele.
  FOR v_texto IN
    SELECT a.attname
      FROM pg_attribute a
     WHERE a.attrelid = '_molde_os'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND (a.attname IN ('id', 'status')
            OR a.attname IN (SELECT b.attname FROM pg_attribute b
                              WHERE b.attrelid = 'public.ordemservico'::regclass
                                AND b.attgenerated <> ''))
  LOOP
    EXECUTE format('ALTER TABLE _molde_os DROP COLUMN %I', v_texto);
  END LOOP;

  -- `chave_acesso` sai junto: é UNIQUE, então o clone não pode herdá-la do
  -- molde — a colisão aconteceria já no INSERT. Ela é reposta logo abaixo com
  -- um valor próprio por linha.
  FOR v_texto IN
    SELECT a.attname
      FROM pg_attribute a
     WHERE a.attrelid = '_molde_nfe'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND (a.attname IN ('id', 'chave_acesso')
            OR a.attname IN (SELECT b.attname FROM pg_attribute b
                              WHERE b.attrelid = 'public.nfe'::regclass
                                AND b.attgenerated <> ''))
  LOOP
    EXECUTE format('ALTER TABLE _molde_nfe DROP COLUMN %I', v_texto);
  END LOOP;

  /* ---------------- três OS: duas do cliente A, uma do cliente B ------- */

  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO v_cols
    FROM pg_attribute
   WHERE attrelid = '_molde_os'::regclass AND attnum > 0 AND NOT attisdropped;

  EXECUTE format(
    'INSERT INTO public.ordemservico (%s, status) SELECT %s, ''ORCAMENTO'' FROM _molde_os RETURNING id',
    v_cols, v_cols
  ) INTO v_os_a;
  EXECUTE format(
    'INSERT INTO public.ordemservico (%s, status) SELECT %s, ''ORCAMENTO'' FROM _molde_os RETURNING id',
    v_cols, v_cols
  ) INTO v_os_b;
  EXECUTE format(
    'INSERT INTO public.ordemservico (%s, status) SELECT %s, ''ORCAMENTO'' FROM _molde_os RETURNING id',
    v_cols, v_cols
  ) INTO v_os_outra;

  UPDATE public.ordemservico SET clienteid = v_cliente_a WHERE id IN (v_os_a, v_os_b);
  UPDATE public.ordemservico SET clienteid = v_cliente_b WHERE id = v_os_outra;

  /* ---------------- duas NF-e em rascunho, ancoradas na OS A e na OS B -- */

  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO v_cols
    FROM pg_attribute
   WHERE attrelid = '_molde_nfe'::regclass AND attnum > 0 AND NOT attisdropped;

  -- A chave sintética carrega letras, então nunca colide com uma chave real
  -- de 44 dígitos que já esteja no banco.
  EXECUTE format(
    'INSERT INTO public.nfe (%s, chave_acesso) '
    || 'SELECT %s, lpad(md5(random()::text || clock_timestamp()::text), 44, ''9'') '
    || 'FROM _molde_nfe RETURNING id',
    v_cols, v_cols
  ) INTO v_nfe_1;
  EXECUTE format(
    'INSERT INTO public.nfe (%s, chave_acesso) '
    || 'SELECT %s, lpad(md5(random()::text || clock_timestamp()::text), 44, ''9'') '
    || 'FROM _molde_nfe RETURNING id',
    v_cols, v_cols
  ) INTO v_nfe_2;

  UPDATE public.nfe
     SET status = 'RASCUNHO',
         is_deleted = false,
         modelo = 'NFE',
         clienteid = v_cliente_a,
         ordemservicoid = v_os_a,
         vendaid = NULL,
         saidaid = NULL,
         entradaid = NULL
   WHERE id = v_nfe_1;

  UPDATE public.nfe
     SET status = 'RASCUNHO',
         is_deleted = false,
         modelo = 'NFE',
         clienteid = v_cliente_a,
         ordemservicoid = v_os_b,
         vendaid = NULL,
         saidaid = NULL,
         entradaid = NULL
   WHERE id = v_nfe_2;

  /* ============ 1. agrupar duas OS do mesmo cliente funciona ============ */

  PERFORM public.vincular_nfe_origens(
    v_nfe_1,
    jsonb_build_array(
      jsonb_build_object('tipo', 'OS', 'origem_id', v_os_a),
      jsonb_build_object('tipo', 'OS', 'origem_id', v_os_b)
    )
  );

  SELECT count(*) INTO v_qtd FROM public.nfe_origem_vinculo WHERE nfe_id = v_nfe_1;
  IF v_qtd = 2 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: duas OS do mesmo cliente agrupadas numa NF-e.';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 1: esperava 2 vínculos, veio %.', v_qtd;
  END IF;

  -- A âncora tem de ser reconhecida sozinha, a partir da coluna escalar.
  SELECT count(*) INTO v_qtd
    FROM public.nfe_origem_vinculo
   WHERE nfe_id = v_nfe_1 AND ancora AND origem_id = v_os_a;
  IF v_qtd = 1 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: a âncora foi derivada da coluna escalar da nota.';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 2: âncora não marcada na OS %.', v_os_a;
  END IF;

  /* ============ 3. reexecutar a RPC é idempotente ====================== */

  PERFORM public.vincular_nfe_origens(
    v_nfe_1,
    jsonb_build_array(
      jsonb_build_object('tipo', 'OS', 'origem_id', v_os_a),
      jsonb_build_object('tipo', 'OS', 'origem_id', v_os_b)
    )
  );

  SELECT count(*) INTO v_qtd FROM public.nfe_origem_vinculo WHERE nfe_id = v_nfe_1;
  IF v_qtd = 2 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 3: reabrir o rascunho não duplica vínculos.';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 3: após reexecutar, vieram % vínculos.', v_qtd;
  END IF;

  /* ============ 4. outra nota não pode tomar uma OS ocupada ============ */

  BEGIN
    PERFORM public.vincular_nfe_origens(
      v_nfe_2,
      jsonb_build_array(
        jsonb_build_object('tipo', 'OS', 'origem_id', v_os_b)
      )
    );
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 4: a segunda nota conseguiu tomar a OS % já ocupada.', v_os_b;
  EXCEPTION
    WHEN unique_violation THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 4: OS ocupada por outra nota viva foi recusada (23505).';
  END;

  /* ============ 5. cancelar a primeira nota libera as OS =============== */

  UPDATE public.nfe SET status = 'CANCELADA' WHERE id = v_nfe_1;

  SELECT count(*) INTO v_qtd
    FROM public.nfe_origem_vinculo WHERE nfe_id = v_nfe_1 AND ativo;
  IF v_qtd = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 5: cancelar a nota desativou os vínculos e liberou as OS.';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 5: % vínculo(s) continuaram ativos após o cancelamento.', v_qtd;
  END IF;

  -- E a nota cancelada continua vinculada, para aparecer no histórico das OS.
  SELECT count(*) INTO v_qtd FROM public.nfe_origem_vinculo WHERE nfe_id = v_nfe_1;
  IF v_qtd = 2 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 6: a nota cancelada segue vinculada às duas OS (histórico).';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 6: o cancelamento apagou vínculos; restaram %.', v_qtd;
  END IF;

  /* ============ 7. agora a segunda nota consegue a OS B =============== */

  BEGIN
    PERFORM public.vincular_nfe_origens(
      v_nfe_2,
      jsonb_build_array(
        jsonb_build_object('tipo', 'OS', 'origem_id', v_os_b)
      )
    );
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 7: com a nota anterior cancelada, a OS voltou a ser emitível.';
  EXCEPTION
    WHEN OTHERS THEN
      v_falhou := v_falhou + 1;
      RAISE WARNING 'FALHOU 7: a OS liberada continuou bloqueada (%).', SQLERRM;
  END;

  /* ============ 8. origem de outro cliente é recusada ================= */

  BEGIN
    PERFORM public.vincular_nfe_origens(
      v_nfe_2,
      jsonb_build_array(
        jsonb_build_object('tipo', 'OS', 'origem_id', v_os_b),
        jsonb_build_object('tipo', 'OS', 'origem_id', v_os_outra)
      )
    );
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 8: aceitou agrupar OS de cliente diferente.';
  EXCEPTION
    WHEN check_violation THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 8: OS de outro cliente recusada — destinatário único.';
  END;

  /* ============ 9. o grupo não pode perder a âncora =================== */

  BEGIN
    PERFORM public.vincular_nfe_origens(
      v_nfe_2,
      jsonb_build_array(
        jsonb_build_object('tipo', 'OS', 'origem_id', v_os_a)
      )
    );
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 9: aceitou um grupo sem a origem âncora da nota.';
  EXCEPTION
    WHEN sqlstate '22023' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 9: grupo sem a origem âncora recusado.';
  END;

  /* ============ 10. misturar OS e venda é recusado ==================== */

  BEGIN
    PERFORM public.vincular_nfe_origens(
      v_nfe_2,
      jsonb_build_array(
        jsonb_build_object('tipo', 'OS', 'origem_id', v_os_b),
        jsonb_build_object('tipo', 'VENDA', 'origem_id', v_os_b)
      )
    );
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 10: aceitou misturar OS e venda na mesma nota.';
  EXCEPTION
    WHEN sqlstate '22023' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 10: mistura de OS com venda recusada.';
  END;

  /* ============ 11. NFC-e não entra na junção ======================== */

  -- A NFC-e aceita como destinatário o consumidor que se identifica no caixa,
  -- que pode não ser o cliente da venda. Se ela entrasse na junção, a
  -- validação de destinatário único recusaria uma emissão legítima de balcão.
  UPDATE public.nfe SET modelo = 'NFCE' WHERE id = v_nfe_2;

  BEGIN
    PERFORM public.vincular_nfe_origens(
      v_nfe_2,
      jsonb_build_array(
        jsonb_build_object('tipo', 'OS', 'origem_id', v_os_b)
      )
    );
    v_falhou := v_falhou + 1;
    RAISE WARNING 'FALHOU 11: aceitou vincular origem a uma NFC-e.';
  EXCEPTION
    WHEN sqlstate '22023' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 11: NFC-e recusada na junção — segue pelo caminho de sempre.';
  END;

  UPDATE public.nfe SET modelo = 'NFE' WHERE id = v_nfe_2;

  /* ---------------- resultado ---------------- */

  RAISE NOTICE '---';
  RAISE NOTICE 'Verificações OK: %, falhas: %', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION '% verificação(ões) falharam.', v_falhou;
  END IF;
END;
$teste$;

ROLLBACK;
