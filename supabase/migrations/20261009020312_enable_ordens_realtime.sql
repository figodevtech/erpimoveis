begin;

-- Avisos opacos: nenhum dado da OS é enviado fora das APIs autenticadas.
create or replace function public.ordens_realtime_emit()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_tenant integer;
begin
  select id into v_tenant from public.empresa order by id limit 1;
  if v_tenant is not null then
    perform realtime.send(jsonb_build_object('table', tg_table_name),
      'ordens_changed', 'ordens:tenant:' || v_tenant::text, true);
  end if;
  return null;
exception when others then
  -- Uma indisponibilidade do socket não pode impedir o trabalho na oficina.
  raise warning '[ordens] realtime indisponivel: %', sqlerrm;
  return null;
end;
$$;

revoke all on function public.ordens_realtime_emit() from public, anon, authenticated;

drop trigger if exists ordens_realtime_changed on public.ordemservico;

create trigger ordens_realtime_changed after insert or update or delete on public.ordemservico
for each statement execute function public.ordens_realtime_emit();

drop trigger if exists ordens_realtime_changed on public.osservico;

create trigger ordens_realtime_changed after insert or update or delete on public.osservico
for each statement execute function public.ordens_realtime_emit();

drop trigger if exists ordens_realtime_changed on public.osservico_realizador;

create trigger ordens_realtime_changed after insert or update or delete on public.osservico_realizador
for each statement execute function public.ordens_realtime_emit();

-- O projeto usa um banco por oficina. O tópico deve ser o da empresa deste banco.
create or replace function public.ordens_realtime_topic_allowed(p_topic text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.usuario u
    where u.id = auth.uid() and u.ativo
      and p_topic = 'ordens:tenant:' || (select id from public.empresa order by id limit 1)::text
      and (coalesce(u.is_root, false) or exists (
        select 1 from public.perfilpermissao pp
        join public.permissao p on p.id = pp.permissaoid
        where pp.perfilid = u.perfilid and lower(trim(p.nome)) in
          ('ordens:visualizar', 'execucao_os:visualizar', 'acompanhamento:visualizar', 'financeiro:acompanhamento')
      ))
  );
$$;

revoke all on function public.ordens_realtime_topic_allowed(text) from public, anon;

grant execute on function public.ordens_realtime_topic_allowed(text) to authenticated, service_role;

drop policy if exists ordens_realtime_receive on realtime.messages;

create policy ordens_realtime_receive on realtime.messages for select to authenticated
using (extension = 'broadcast' and public.ordens_realtime_topic_allowed((select realtime.topic())));

commit;
