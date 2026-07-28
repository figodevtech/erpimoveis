-- O acompanhamento financeiro depende destes eventos para atualizar sem polling.
-- O bloco e idempotente para funcionar em bancos onde alguma tabela ja foi publicada.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'transacao'
  ) then
    alter publication supabase_realtime add table public.transacao;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'venda'
  ) then
    alter publication supabase_realtime add table public.venda;
  end if;
end
$$;
