insert into public.permissao (nome, descricao)
values ('EXECUCAO_OS_ACESSO', 'Acesso a tela operacional de execucao de ordens de servico')
on conflict (nome) do update
set descricao = excluded.descricao;

alter table public.osservico_realizador
add column if not exists status_execucao text not null default 'PENDENTE',
add column if not exists iniciado_em timestamp with time zone,
add column if not exists finalizado_em timestamp with time zone,
add column if not exists observacao_execucao text;

alter table public.osservico_realizador
drop constraint if exists osservico_realizador_status_execucao_check;

alter table public.osservico_realizador
add constraint osservico_realizador_status_execucao_check
check (status_execucao in ('PENDENTE', 'EM_EXECUCAO', 'FINALIZADO'));

create index if not exists idx_osservico_realizador_execucao_usuario
on public.osservico_realizador (usuarioid, status_execucao);

create index if not exists idx_osservico_realizador_execucao_os
on public.osservico_realizador (ordemservicoid, status_execucao);
