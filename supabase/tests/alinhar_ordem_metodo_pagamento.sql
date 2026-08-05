-- Teste da migration 20260805140000_alinhar_ordem_metodo_pagamento contra um
-- banco real.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/alinhar_ordem_metodo_pagamento.sql demir
--
-- Tudo acontece dentro de uma transação que termina em ROLLBACK: o tipo é
-- recriado, as duas colunas são convertidas, as verificações rodam e no fim
-- nada é persistido.
--
-- O teste checa três coisas:
--   1. a ordem final do enum é a canônica;
--   2. nenhum valor gravado em ordemservico/transacao se perdeu na conversão;
--   3. o check ordemservico_parcelas_compativel_forma continua existindo.
BEGIN;

-- Fotografia dos dados antes da conversão.
CREATE TEMP TABLE _antes_os ON COMMIT DROP AS
SELECT id, forma_pagamento::text AS forma FROM public.ordemservico;

CREATE TEMP TABLE _antes_tr ON COMMIT DROP AS
SELECT id, metodopagamento::text AS metodo FROM public.transacao;

DO $$
DECLARE
  ordem text[];
BEGIN
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO ordem
    FROM pg_enum e WHERE e.enumtypid = 'public.metodo_pagamento'::regtype;
  RAISE NOTICE 'ordem antes: %', ordem;
END $$;

-- ==========================================================================
-- Corpo da migration (cópia fiel de 20260805140000).
-- ==========================================================================
do $$
declare
  ordem_canonica text[] := array[
    'PIX', 'CREDITO', 'DEBITO', 'BOLETO', 'TRANSFERENCIA', 'DINHEIRO', 'TED', 'DOC'
  ];
  ordem_atual text[];
  ordem_desejada text[];
  lista_sql text;
begin
  select array_agg(e.enumlabel order by e.enumsortorder)
    into ordem_atual
    from pg_enum e
   where e.enumtypid = 'public.metodo_pagamento'::regtype;

  select array_agg(t.label order by t.chave, t.label)
    into ordem_desejada
    from (
      select e.enumlabel::text as label,
             coalesce(array_position(ordem_canonica, e.enumlabel::text), 1000) as chave
        from pg_enum e
       where e.enumtypid = 'public.metodo_pagamento'::regtype
    ) t;

  if ordem_atual is null or ordem_atual = ordem_desejada then
    raise notice 'ordem ja canonica: nada a fazer';
    return;
  end if;

  select string_agg(quote_literal(x.label), ', ' order by x.pos)
    into lista_sql
    from unnest(ordem_desejada) with ordinality as x(label, pos);

  execute 'alter type public.metodo_pagamento rename to metodo_pagamento_desalinhado';
  execute format('create type public.metodo_pagamento as enum (%s)', lista_sql);

  execute 'alter table public.ordemservico
             drop constraint if exists ordemservico_parcelas_compativel_forma';

  execute 'alter table public.ordemservico
             alter column forma_pagamento type public.metodo_pagamento
             using forma_pagamento::text::public.metodo_pagamento';

  execute 'alter table public.transacao
             alter column metodopagamento type public.metodo_pagamento
             using metodopagamento::text::public.metodo_pagamento';

  execute 'alter table public.ordemservico
             add constraint ordemservico_parcelas_compativel_forma
             check (
               parcelas_pagamento is null
               or forma_pagamento in (''CREDITO'', ''BOLETO'')
             )';

  execute 'drop type public.metodo_pagamento_desalinhado';
end
$$;

-- ==========================================================================
-- Verificações.
-- ==========================================================================
DO $$
DECLARE
  ordem text[];
  divergentes bigint;
  tem_check boolean;
  tipos_orfaos bigint;
BEGIN
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO ordem
    FROM pg_enum e WHERE e.enumtypid = 'public.metodo_pagamento'::regtype;
  RAISE NOTICE 'ordem depois: %', ordem;

  IF ordem <> ARRAY['PIX','CREDITO','DEBITO','BOLETO','TRANSFERENCIA','DINHEIRO','TED','DOC'] THEN
    RAISE EXCEPTION 'Ordem final inesperada: %', ordem;
  END IF;

  SELECT count(*) INTO divergentes
    FROM _antes_os a
    JOIN public.ordemservico o ON o.id = a.id
   WHERE o.forma_pagamento::text IS DISTINCT FROM a.forma;
  IF divergentes > 0 THEN
    RAISE EXCEPTION 'ordemservico.forma_pagamento mudou em % linha(s)', divergentes;
  END IF;

  SELECT count(*) INTO divergentes
    FROM _antes_tr a
    JOIN public.transacao t ON t.id = a.id
   WHERE t.metodopagamento::text IS DISTINCT FROM a.metodo;
  IF divergentes > 0 THEN
    RAISE EXCEPTION 'transacao.metodopagamento mudou em % linha(s)', divergentes;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ordemservico_parcelas_compativel_forma'
       AND conrelid = 'public.ordemservico'::regclass
  ) INTO tem_check;
  IF NOT tem_check THEN
    RAISE EXCEPTION 'O check ordemservico_parcelas_compativel_forma nao foi recriado';
  END IF;

  SELECT count(*) INTO tipos_orfaos
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' AND t.typname = 'metodo_pagamento_desalinhado';
  IF tipos_orfaos > 0 THEN
    RAISE EXCEPTION 'O tipo antigo nao foi removido';
  END IF;

  RAISE NOTICE 'Verificacoes OK: ordem canonica, dados preservados, check no lugar.';
END $$;

-- Idempotência: roda o corpo da migration de novo, já com a ordem canônica.
-- Precisa cair no `return` inicial e não tocar em nada.
CREATE TEMP TABLE _oid_antes ON COMMIT DROP AS
SELECT 'public.metodo_pagamento'::regtype::oid AS oid_tipo;

do $$
declare
  ordem_canonica text[] := array[
    'PIX', 'CREDITO', 'DEBITO', 'BOLETO', 'TRANSFERENCIA', 'DINHEIRO', 'TED', 'DOC'
  ];
  ordem_atual text[];
  ordem_desejada text[];
  lista_sql text;
begin
  select array_agg(e.enumlabel order by e.enumsortorder)
    into ordem_atual
    from pg_enum e
   where e.enumtypid = 'public.metodo_pagamento'::regtype;

  select array_agg(t.label order by t.chave, t.label)
    into ordem_desejada
    from (
      select e.enumlabel::text as label,
             coalesce(array_position(ordem_canonica, e.enumlabel::text), 1000) as chave
        from pg_enum e
       where e.enumtypid = 'public.metodo_pagamento'::regtype
    ) t;

  if ordem_atual is null or ordem_atual = ordem_desejada then
    raise notice 'segunda execucao: ordem ja canonica, nada a fazer';
    return;
  end if;

  raise exception 'Segunda execucao tentou recriar o tipo (nao e idempotente)';
end
$$;

DO $$
BEGIN
  IF (SELECT oid_tipo FROM _oid_antes) <> 'public.metodo_pagamento'::regtype::oid THEN
    RAISE EXCEPTION 'Segunda execucao recriou o tipo';
  END IF;
  RAISE NOTICE 'Idempotencia OK.';
END $$;

-- Nada acima é persistido.
ROLLBACK;
