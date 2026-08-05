-- Alinha a ordem fisica do enum public.metodo_pagamento entre os bancos.
--
-- Em 20260804190000 os valores entraram como 'TED' e depois 'DOC'. Num dos
-- bancos o 'DOC' ja existia antes dessa migration, entao o 'TED' foi anexado
-- depois dele e o enumsortorder ficou invertido em relacao aos demais.
-- listar_metodos_pagamento() ordena por enumsortorder, entao a lista de formas
-- de pagamento aparecia em ordem diferente naquele banco, e a comparacao de
-- schema do deploy acusava divergencia na categoria "enums".
--
-- O bloco e idempotente: quando a ordem ja e a canonica, nao faz nada. Labels
-- que porventura existam fora da lista canonica sao preservados no fim.
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
    return;
  end if;

  select string_agg(quote_literal(x.label), ', ' order by x.pos)
    into lista_sql
    from unnest(ordem_desejada) with ordinality as x(label, pos);

  -- O rename preserva o OID, entao as colunas continuam apontando para o tipo
  -- antigo ate serem convertidas abaixo.
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

  -- Recriado com a mesma definicao de 20260804190000.
  execute 'alter table public.ordemservico
             add constraint ordemservico_parcelas_compativel_forma
             check (
               parcelas_pagamento is null
               or forma_pagamento in (''CREDITO'', ''BOLETO'')
             )';

  execute 'drop type public.metodo_pagamento_desalinhado';
end
$$;
