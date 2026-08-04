alter type public.metodo_pagamento add value if not exists 'TED';
alter type public.metodo_pagamento add value if not exists 'DOC';

create or replace function public.listar_metodos_pagamento()
returns table(value text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select enum_value.enumlabel::text
  from pg_catalog.pg_type enum_type
  join pg_catalog.pg_namespace enum_namespace
    on enum_namespace.oid = enum_type.typnamespace
  join pg_catalog.pg_enum enum_value
    on enum_value.enumtypid = enum_type.oid
  where enum_namespace.nspname = 'public'
    and enum_type.typname = 'metodo_pagamento'
  order by enum_value.enumsortorder;
$$;

revoke all on function public.listar_metodos_pagamento() from public;
grant execute on function public.listar_metodos_pagamento() to service_role;

alter table public.ordemservico
  drop constraint if exists ordemservico_forma_pagamento_valida,
  drop constraint if exists ordemservico_parcelas_compativel_forma;

alter table public.ordemservico
  alter column forma_pagamento type public.metodo_pagamento
  using forma_pagamento::public.metodo_pagamento;

alter table public.ordemservico
  add constraint ordemservico_parcelas_compativel_forma
  check (
    parcelas_pagamento is null
    or forma_pagamento in ('CREDITO', 'BOLETO')
  );
