begin;

-- Simula as tabelas sem alterar ordens ou serviços reais.
create temporary table ordemservico(id integer, status text) on commit drop;
create trigger ordens_realtime_test after insert or update or delete on pg_temp.ordemservico
for each statement execute function public.ordens_realtime_emit();
do $$
declare v_topic text := 'ordens:tenant:' || (select min(id) from public.empresa)::text;
        v_before bigint; v_after bigint; v_status text;
begin
  select count(*) into v_before from realtime.messages where topic=v_topic and event='ordens_changed';
  insert into pg_temp.ordemservico values(1,'ORCAMENTO');
  for v_status in select unnest(enum_range(null::public.enum_status_os))::text loop
    update pg_temp.ordemservico set status=v_status where id=1;
  end loop;
  delete from pg_temp.ordemservico;
  select count(*) into v_after from realtime.messages where topic=v_topic and event='ordens_changed';
  if v_after - v_before <> 2 + array_length(enum_range(null::public.enum_status_os),1) then
    raise exception 'Nem todos os status geraram broadcast';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.ordemservico'::regclass and tgname='ordens_realtime_changed' and tgenabled='O') then
    raise exception 'Trigger principal ausente ou desabilitado';
  end if;
  if has_table_privilege('anon','public.ordemservico','SELECT') or has_table_privilege('authenticated','public.ordemservico','SELECT') then
    raise exception 'Realtime não deve liberar leitura direta das ordens';
  end if;
  if has_function_privilege('anon','public.ordens_realtime_emit()','EXECUTE') or has_function_privilege('authenticated','public.ordens_realtime_emit()','EXECUTE') then
    raise exception 'Emissão interna não pode ser executada pelo navegador';
  end if;
  if exists(select 1 from realtime.messages where topic=v_topic and event='ordens_changed' and payload->'payload' is not null and (payload->'payload') - 'table' <> '{}'::jsonb) then
    raise exception 'Payload deve conter apenas nome da tabela';
  end if;
end $$;

do $$
declare v_user uuid; v_topic text := 'ordens:tenant:' || (select min(id) from public.empresa)::text;
begin
  select u.id into v_user from public.usuario u where u.ativo and (u.is_root or exists (
    select 1 from public.perfilpermissao pp join public.permissao p on p.id=pp.permissaoid
    where pp.perfilid=u.perfilid and lower(trim(p.nome)) in
      ('ordens:visualizar','execucao_os:visualizar','acompanhamento:visualizar','financeiro:acompanhamento')
  )) limit 1;
  if v_user is null then raise exception 'Usuário ativo de teste de autorização não encontrado'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_user,'role','authenticated')::text, true);
  if not public.ordens_realtime_topic_allowed(v_topic) then raise exception 'Usuário autorizado recusado'; end if;
  if public.ordens_realtime_topic_allowed(v_topic || '9') then raise exception 'Outro tenant autorizado'; end if;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}', true);
  if public.ordens_realtime_topic_allowed(v_topic) then raise exception 'Usuário inexistente autorizado'; end if;
end $$;
rollback;
