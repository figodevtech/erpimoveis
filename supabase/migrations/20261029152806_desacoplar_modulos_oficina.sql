begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- A poda do código não autoriza remover tabelas que ainda sustentam joins,
-- FKs e rotinas compartilhadas do financeiro/estoque. Esta etapa alinha os
-- catálogos e a publicação Realtime aos módulos efetivamente mantidos.
do $$
begin
  if to_regclass('public.usuario') is null
     or to_regclass('public.perfilpermissao') is null
     or to_regclass('public.transacao') is null
     or to_regclass('public.venda') is null then
    raise exception 'Esta migration exige o banco do ERP, não o banco de um site';
  end if;
end $$;

-- Lista fechada: preserva permissões desconhecidas de módulos futuros.
do $$
declare
  removidas constant text[] := array[
    'ordens:visualizar', 'ordens:criar', 'ordens:editar', 'ordens:excluir',
    'ordens:rentabilidade', 'ordens:eventos_financeiros',
    'ordens:finalizar_sem_cobranca', 'ordens:excluir_checklist_assinado',
    'ordens:alterar_criador',
    'orcamentos:visualizar', 'orcamentos:criar', 'orcamentos:editar', 'orcamentos:excluir',
    'veiculos:visualizar', 'veiculos:criar', 'veiculos:editar', 'veiculos:excluir',
    'desmanche:visualizar', 'desmanche:criar', 'desmanche:editar', 'desmanche:excluir',
    'execucao_os:visualizar', 'execucao_os:editar',
    'alugueis:visualizar', 'alugueis:criar', 'alugueis:editar', 'alugueis:excluir',
    'tipos:cores_veiculos:visualizar', 'tipos:cores_veiculos:criar',
    'tipos:cores_veiculos:editar', 'tipos:cores_veiculos:excluir',
    'financeiro:pagamento_de_ordens'
  ];
begin
  delete from public.perfilpermissao pp using public.permissao p
  where pp.permissaoid = p.id and lower(btrim(p.nome)) = any(removidas);

  delete from public.permissao where lower(btrim(nome)) = any(removidas);
end $$;

update public.permissao
set descricao = 'Acesso base aos dados financeiros e às APIs compartilhadas; as telas têm permissões próprias.'
where nome = 'financeiro:visualizar';

update public.permissao
set descricao = 'Abrir a lista de eventos financeiros'
where nome = 'financeiro:eventos_de_ordens';

-- Mantém o identificador financeiro:eventos_de_ordens porque o módulo
-- genérico de eventos financeiros ainda o utiliza no código atual.
do $$
declare
  tabela text;
begin
  for tabela in
    select tablename from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('ordemservico', 'osservico', 'osservico_realizador')
  loop
    execute format('alter publication supabase_realtime drop table public.%I', tabela);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
