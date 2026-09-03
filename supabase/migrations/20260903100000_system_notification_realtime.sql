begin;

-- As notificacoes sao criadas pelo backend com service_role. O cliente recebe
-- somente os INSERTs destinados ao proprio usuario, usando o JWT curto emitido
-- pelo ERP para o Supabase Realtime.
grant select on table public.system_notification to authenticated;

drop policy if exists system_notification_select_own on public.system_notification;
create policy system_notification_select_own
  on public.system_notification
  for select
  to authenticated
  using (usuario_id = auth.uid());

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'system_notification'
  ) then
    alter publication supabase_realtime add table public.system_notification;
  end if;
end
$$;

commit;
