-- Permissoes dedicadas para as abas financeiras do detalhe da OS.
-- 'ordens:rentabilidade'        -> aba Rentabilidade
-- 'ordens:eventos_financeiros'  -> aba Eventos Financeiros
insert into public.permissao (nome, descricao)
values
  ('ordens:rentabilidade', 'Visualizar rentabilidade (custos, margem e lucro) das ordens de servico'),
  ('ordens:eventos_financeiros', 'Visualizar e lancar eventos financeiros das ordens de servico')
on conflict (nome) do update
set descricao = excluded.descricao;

-- Backfill: perfis que ja acessam o modulo Financeiro mantem o acesso atual as abas.
insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, nova.id
from public.perfilpermissao pp
join public.permissao base on base.id = pp.permissaoid and base.nome = 'financeiro:visualizar'
join public.permissao nova on nova.nome in ('ordens:rentabilidade', 'ordens:eventos_financeiros')
on conflict do nothing;
