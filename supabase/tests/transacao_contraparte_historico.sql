-- Teste do gatilho que registra a troca de pagador/recebedor.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/transacao_contraparte_historico.sql
--   npm run db:test:sql -- supabase/tests/transacao_contraparte_historico.sql demir
--
-- Tudo dentro de uma transacao que termina em ROLLBACK: nada e escrito no banco.
--
-- A linha de teste e clonada de um registro existente (tabela temporaria
-- `_molde`), entao o script nao precisa conhecer o schema inteiro.

BEGIN;

DO $t$
DECLARE
  v_col_gerada text;
  v_cols text;
  v_id bigint;
  v_cliente bigint;
  v_fornecedor bigint;
  v_autor uuid;
  v_linhas int;
  v_h public.transacao_contraparte_historico%ROWTYPE;
  v_ok int := 0;
  v_falhou int := 0;
BEGIN
  /* ---------------- pre-requisitos ---------------- */

  IF to_regclass('public.transacao_contraparte_historico') IS NULL THEN
    RAISE EXCEPTION 'A tabela de historico nao existe. Rode as migrations primeiro.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.transacao'::regclass
       AND tgname = 'transacao_contraparte_historico_trg'
  ) THEN
    RAISE EXCEPTION 'O gatilho transacao_contraparte_historico_trg nao existe.';
  END IF;

  SELECT id INTO v_cliente FROM public.cliente ORDER BY id LIMIT 1;
  SELECT id INTO v_fornecedor FROM public.fornecedor ORDER BY id LIMIT 1;

  /*
   * O autor precisa ser um usuario que existe.
   *
   * `transacao.updated_by` referencia `usuario(id)`, e um `gen_random_uuid()`
   * derruba o UPDATE com transacao_updated_by_fkey antes de o gatilho de
   * historico chegar a rodar — o teste acusava o gatilho por uma FK que esta
   * certa. Isso ficou escondido enquanto o script morria antes, no molde.
   */
  SELECT id INTO v_autor FROM public.usuario ORDER BY id LIMIT 1;

  IF v_autor IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuario cadastrado para servir de autor.';
  END IF;

  /* ---------------- fixture ---------------- */

  CREATE TEMP TABLE _molde ON COMMIT DROP AS
    SELECT * FROM public.transacao WHERE is_deleted = false LIMIT 1;

  /*
   * Coluna gerada nao se insere: `data_dia` (20260901220000) veio depois deste
   * teste e passou a entrar no `SELECT *` do molde, quebrando todos os inserts
   * com "cannot insert a non-DEFAULT value". Some do molde e a lista de colunas
   * passa a ser explicita — o script continua sem conhecer o schema, e uma
   * coluna gerada nova amanha tambem nao o quebra.
   */
  FOR v_col_gerada IN
    SELECT a.attname
      FROM pg_attribute a
     WHERE a.attrelid = '_molde'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND a.attname IN (
         SELECT b.attname FROM pg_attribute b
          WHERE b.attrelid = 'public.transacao'::regclass
            AND b.attgenerated <> ''
       )
  LOOP
    EXECUTE format('ALTER TABLE _molde DROP COLUMN %I', v_col_gerada);
  END LOOP;

  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = '_molde'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;
  IF (SELECT count(*) FROM _molde) <> 1 THEN
    RAISE EXCEPTION 'Nenhuma transacao para servir de molde.';
  END IF;

  UPDATE _molde SET
    id = nextval(pg_get_serial_sequence('public.transacao','id')),
    ordemservicoid = NULL, vendaid = NULL, entrada_id = NULL, usoconsumo_entrada_id = NULL,
    evento_financeiro_id = NULL, estorno_transacao_id = NULL, pagamento_multiplo_id = NULL,
    adiantamento_id = NULL, eh_adiantamento = false, parcelamento_id = NULL,
    is_deleted = false,
    cliente_id = NULL, fornecedor_id = NULL,
    nomepagador = 'PAGADOR ORIGINAL', cpfcnpjpagador = '00000000000',
    updated_by = NULL,
    descricao = 'TESTE TROCA DE CONTRAPARTE';
  EXECUTE format('INSERT INTO public.transacao (%s) SELECT %s FROM _molde', v_cols, v_cols);
  SELECT id INTO v_id FROM _molde;

  /* ---------------- 1. inserir nao gera historico ---------------- */

  SELECT count(*) INTO v_linhas
    FROM public.transacao_contraparte_historico WHERE transacao_id = v_id;

  IF v_linhas = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 1: criar a transacao nao gera linha de troca';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 1: % linha(s) de historico logo apos o INSERT', v_linhas;
  END IF;

  /* ---------------- 2. mexer em outro campo nao gera historico ---------------- */

  UPDATE public.transacao SET descricao = 'TESTE OUTRO CAMPO' WHERE id = v_id;

  SELECT count(*) INTO v_linhas
    FROM public.transacao_contraparte_historico WHERE transacao_id = v_id;

  IF v_linhas = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 2: alterar a descricao nao entra no historico de contraparte';
  ELSE
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 2: alterar a descricao gerou % linha(s)', v_linhas;
  END IF;

  /* ---------------- 3. vincular um cliente registra a troca ---------------- */

  IF v_cliente IS NULL THEN
    RAISE NOTICE 'PULADO 3: nenhum cliente cadastrado.';
  ELSE
    UPDATE public.transacao
       SET cliente_id = v_cliente,
           nomepagador = 'CLIENTE ESCOLHIDO',
           cpfcnpjpagador = '11111111111',
           updated_by = v_autor
     WHERE id = v_id;

    SELECT * INTO v_h
      FROM public.transacao_contraparte_historico
     WHERE transacao_id = v_id
     ORDER BY id DESC LIMIT 1;

    IF v_h.cliente_anterior_id IS NULL
       AND v_h.cliente_novo_id = v_cliente
       AND v_h.nome_anterior = 'PAGADOR ORIGINAL'
       AND v_h.nome_novo = 'CLIENTE ESCOLHIDO'
       AND v_h.documento_anterior = '00000000000'
       AND v_h.documento_novo = '11111111111'
       AND v_h.alterado_por = v_autor THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 3: vincular cliente gravou o antes, o depois e o autor';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 3: cliente %->%, nome %->%, doc %->%, autor %',
        v_h.cliente_anterior_id, v_h.cliente_novo_id,
        v_h.nome_anterior, v_h.nome_novo,
        v_h.documento_anterior, v_h.documento_novo, v_h.alterado_por;
    END IF;
  END IF;

  /* ---------------- 4. trocar cliente por fornecedor registra os dois lados ---------------- */

  IF v_cliente IS NULL OR v_fornecedor IS NULL THEN
    RAISE NOTICE 'PULADO 4: falta cliente ou fornecedor cadastrado.';
  ELSE
    UPDATE public.transacao
       SET cliente_id = NULL,
           fornecedor_id = v_fornecedor,
           nomepagador = 'FORNECEDOR ESCOLHIDO',
           cpfcnpjpagador = '22222222222222'
     WHERE id = v_id;

    SELECT * INTO v_h
      FROM public.transacao_contraparte_historico
     WHERE transacao_id = v_id
     ORDER BY id DESC LIMIT 1;

    IF v_h.cliente_anterior_id = v_cliente
       AND v_h.cliente_novo_id IS NULL
       AND v_h.fornecedor_anterior_id IS NULL
       AND v_h.fornecedor_novo_id = v_fornecedor THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 4: a troca de cliente para fornecedor guardou as duas pontas';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 4: cliente %->%, fornecedor %->%',
        v_h.cliente_anterior_id, v_h.cliente_novo_id,
        v_h.fornecedor_anterior_id, v_h.fornecedor_novo_id;
    END IF;

    SELECT count(*) INTO v_linhas
      FROM public.transacao_contraparte_historico WHERE transacao_id = v_id;

    IF v_linhas = 2 THEN
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK 5: duas trocas, duas linhas — o historico acumula';
    ELSE
      v_falhou := v_falhou + 1;
      RAISE NOTICE 'FALHOU 5: esperava 2 linhas, achei %', v_linhas;
    END IF;
  END IF;

  /* ---------------- 6. o historico e imutavel ---------------- */

  BEGIN
    UPDATE public.transacao_contraparte_historico
       SET nome_novo = 'ADULTERADO'
     WHERE transacao_id = v_id;
    v_falhou := v_falhou + 1;
    RAISE NOTICE 'FALHOU 6: o historico aceitou UPDATE';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok + 1;
    RAISE NOTICE 'OK 6: o historico recusou o UPDATE (%)', SQLERRM;
  END;

  RAISE NOTICE '--------------------------------';
  RAISE NOTICE 'Resultado: % ok, % falhou', v_ok, v_falhou;

  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Teste falhou em % verificacao(oes).', v_falhou;
  END IF;
END
$t$;

ROLLBACK;
