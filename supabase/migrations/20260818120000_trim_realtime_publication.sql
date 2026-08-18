-- Tira da publicacao do Realtime as tabelas que nenhuma tela assina.
--
-- Toda tabela publicada entra na decodificacao logica do WAL, e o
-- `realtime.apply_rls` paga por ela em cada volta do poll mesmo quando nao ha
-- assinante nenhum. No banco do Demir esse poll respondia por 84% de todo o
-- CPU de query, custando 154 ms por chamada.
--
-- `produto` esta publicada desde o baseline e nunca teve assinante. `nfse`
-- tinha assinantes, mas todos rodavam como `anon` numa tabela com RLS ligado e
-- zero policies: nenhum evento jamais foi entregue. As telas que dependiam
-- disso passaram a consultar a Focus diretamente.
--
-- O bloco e idempotente: so mexe no que ainda estiver publicado.
do $$
begin
  if exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'produto'
  ) then
    alter publication supabase_realtime drop table public.produto;
  end if;

  if exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'nfse'
  ) then
    alter publication supabase_realtime drop table public.nfse;
  end if;
end
$$;
