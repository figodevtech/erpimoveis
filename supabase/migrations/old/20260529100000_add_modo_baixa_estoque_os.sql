alter table public.config_geral
add column if not exists modo_baixa_estoque_os text not null default 'ORCAMENTO';

alter table public.config_geral
drop constraint if exists config_geral_modo_baixa_estoque_os_chk;

alter table public.config_geral
add constraint config_geral_modo_baixa_estoque_os_chk
check (modo_baixa_estoque_os in ('ORCAMENTO', 'EXECUCAO'));
