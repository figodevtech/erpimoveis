-- Fecha o schema público para acesso direto pelo navegador.
--
-- O ERP autentica com NextAuth e acessa os dados exclusivamente por APIs do
-- servidor usando service_role. Portanto anon/authenticated não precisam de
-- privilégios diretos em tabelas, views, sequences ou funções do public.

do $$
declare
  relation record;
begin
  for relation in
    select n.nspname as schema_name, c.relname as relation_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table %I.%I enable row level security',
      relation.schema_name,
      relation.relation_name
    );
    execute format(
      'alter table %I.%I no force row level security',
      relation.schema_name,
      relation.relation_name
    );
  end loop;
end
$$;

revoke create on schema public from public, anon, authenticated;

revoke all privileges on all tables in schema public
  from public, anon, authenticated;
revoke all privileges on all sequences in schema public
  from public, anon, authenticated;
-- Extensões como pg_trgm podem instalar funções no public pertencentes ao
-- administrador da plataforma. Elas não são funções da aplicação e não podem
-- ter ACL alterada pelo usuário de migrations do projeto.
do $$
declare
  routine record;
begin
  for routine in
    select n.nspname as schema_name,
           p.proname as routine_name,
           pg_get_function_identity_arguments(p.oid) as identity_arguments
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and not exists (
         select 1
           from pg_depend d
          where d.classid = 'pg_proc'::regclass
            and d.objid = p.oid
            and d.deptype = 'e'
       )
  loop
    execute format(
      'revoke all privileges on function %I.%I(%s) from public, anon, authenticated',
      routine.schema_name,
      routine.routine_name,
      routine.identity_arguments
    );
  end loop;
end
$$;

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
do $$
declare
  routine record;
begin
  for routine in
    select n.nspname as schema_name,
           p.proname as routine_name,
           pg_get_function_identity_arguments(p.oid) as identity_arguments
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and not exists (
         select 1
           from pg_depend d
          where d.classid = 'pg_proc'::regclass
            and d.objid = p.oid
            and d.deptype = 'e'
       )
  loop
    execute format(
      'grant all privileges on function %I.%I(%s) to service_role',
      routine.schema_name,
      routine.routine_name,
      routine.identity_arguments
    );
  end loop;
end
$$;

-- Novos objetos criados por migrations também nascem fechados.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public
  grant all privileges on tables to service_role;
alter default privileges for role postgres in schema public
  grant all privileges on sequences to service_role;
alter default privileges for role postgres in schema public
  grant all privileges on functions to service_role;

-- A migration deve falhar caso algum objeto de dados permaneça acessível.
do $$
begin
  if exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and not c.relrowsecurity
  ) then
    raise exception 'Há tabelas do schema public sem RLS';
  end if;

  if exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm')
       and (
         has_table_privilege('anon', c.oid, 'SELECT')
         or has_table_privilege('anon', c.oid, 'INSERT')
         or has_table_privilege('anon', c.oid, 'UPDATE')
         or has_table_privilege('anon', c.oid, 'DELETE')
         or has_table_privilege('authenticated', c.oid, 'SELECT')
         or has_table_privilege('authenticated', c.oid, 'INSERT')
         or has_table_privilege('authenticated', c.oid, 'UPDATE')
         or has_table_privilege('authenticated', c.oid, 'DELETE')
       )
  ) then
    raise exception 'Há tabelas ou views públicas com privilégios para anon/authenticated';
  end if;

  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (
         select 1
           from pg_depend d
          where d.classid = 'pg_proc'::regclass
            and d.objid = p.oid
            and d.deptype = 'e'
       )
       and (
         has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE')
       )
  ) then
    raise exception 'Há funções públicas executáveis por anon/authenticated';
  end if;
end
$$;
