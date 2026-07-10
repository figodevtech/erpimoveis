insert into public.permissao (nome, descricao)
values
  ('dashboard:visualizar', 'Visualizar dashboard'),

  ('clientes:visualizar', 'Visualizar clientes'),
  ('clientes:criar', 'Criar clientes'),
  ('clientes:editar', 'Editar clientes'),
  ('clientes:excluir', 'Excluir clientes'),

  ('ordens:visualizar', 'Visualizar ordens de servico'),
  ('ordens:criar', 'Criar ordens de servico'),
  ('ordens:editar', 'Editar ordens de servico'),
  ('ordens:excluir', 'Excluir ordens de servico'),

  ('agendamentos:visualizar', 'Visualizar agendamentos'),
  ('agendamentos:criar', 'Criar agendamentos'),
  ('agendamentos:editar', 'Editar agendamentos'),
  ('agendamentos:excluir', 'Excluir agendamentos'),

  ('veiculos:visualizar', 'Visualizar veiculos'),
  ('veiculos:criar', 'Criar veiculos'),
  ('veiculos:editar', 'Editar veiculos'),
  ('veiculos:excluir', 'Excluir veiculos'),

  ('estoque:visualizar', 'Visualizar estoque'),
  ('estoque:criar', 'Criar produtos no estoque'),
  ('estoque:editar', 'Editar produtos no estoque'),
  ('estoque:excluir', 'Excluir produtos do estoque'),

  ('vendas:visualizar', 'Visualizar vendas'),
  ('vendas:criar', 'Criar vendas'),
  ('vendas:editar', 'Editar vendas'),
  ('vendas:excluir', 'Excluir vendas'),

  ('financeiro:visualizar', 'Visualizar financeiro'),
  ('financeiro:criar', 'Criar lancamentos financeiros'),
  ('financeiro:editar', 'Editar lancamentos financeiros'),
  ('financeiro:excluir', 'Excluir lancamentos financeiros'),

  ('acompanhamento:visualizar', 'Visualizar acompanhamento'),
  ('relatorios:visualizar', 'Visualizar relatorios'),

  ('configuracoes:visualizar', 'Visualizar configuracoes'),
  ('configuracoes:editar', 'Editar configuracoes'),

  ('usuarios:visualizar', 'Visualizar usuarios'),
  ('usuarios:criar', 'Criar usuarios'),
  ('usuarios:editar', 'Editar usuarios'),
  ('usuarios:excluir', 'Excluir usuarios'),

  ('permissoes:visualizar', 'Visualizar perfis e permissoes'),
  ('permissoes:criar', 'Criar perfis de permissoes'),
  ('permissoes:editar', 'Editar perfis de permissoes'),
  ('permissoes:excluir', 'Excluir perfis de permissoes'),

  ('execucao_os:visualizar', 'Visualizar execucao operacional de ordens'),
  ('execucao_os:editar', 'Atualizar execucao operacional de ordens')
on conflict (nome) do update
set descricao = excluded.descricao;

with mapa(legada, nova) as (
  values
    ('DASHBOARD_ACESSO', 'dashboard:visualizar'),

    ('CLIENTES_ACESSO', 'clientes:visualizar'),
    ('CLIENTES_ACESSO', 'clientes:criar'),
    ('CLIENTES_ACESSO', 'clientes:editar'),
    ('CLIENTES_ACESSO', 'clientes:excluir'),

    ('ORDENS_ACESSO', 'ordens:visualizar'),
    ('ORDENS_ACESSO', 'ordens:criar'),
    ('ORDENS_ACESSO', 'ordens:editar'),
    ('ORDENS_ACESSO', 'ordens:excluir'),

    ('AGENDAMENTOS_ACESSO', 'agendamentos:visualizar'),
    ('AGENDAMENTOS_ACESSO', 'agendamentos:criar'),
    ('AGENDAMENTOS_ACESSO', 'agendamentos:editar'),
    ('AGENDAMENTOS_ACESSO', 'agendamentos:excluir'),

    ('VEICULOS_ACESSO', 'veiculos:visualizar'),
    ('VEICULOS_ACESSO', 'veiculos:criar'),
    ('VEICULOS_ACESSO', 'veiculos:editar'),
    ('VEICULOS_ACESSO', 'veiculos:excluir'),

    ('ESTOQUE_ACESSO', 'estoque:visualizar'),
    ('ESTOQUE_ACESSO', 'estoque:criar'),
    ('ESTOQUE_ACESSO', 'estoque:editar'),
    ('ESTOQUE_ACESSO', 'estoque:excluir'),

    ('VENDAS_ACESSO', 'vendas:visualizar'),
    ('VENDAS_ACESSO', 'vendas:criar'),
    ('VENDAS_ACESSO', 'vendas:editar'),
    ('VENDAS_ACESSO', 'vendas:excluir'),

    ('FINANCEIRO_ACESSO', 'financeiro:visualizar'),
    ('FINANCEIRO_ACESSO', 'financeiro:criar'),
    ('FINANCEIRO_ACESSO', 'financeiro:editar'),
    ('FINANCEIRO_ACESSO', 'financeiro:excluir'),

    ('ACOMPANHAMENTO_ACESSO', 'acompanhamento:visualizar'),
    ('RELATORIOS_ACESSO', 'relatorios:visualizar'),

    ('CONFIG_ACESSO', 'configuracoes:visualizar'),
    ('CONFIG_ACESSO', 'configuracoes:editar'),
    ('CONFIG_ACESSO', 'permissoes:visualizar'),
    ('CONFIG_ACESSO', 'permissoes:criar'),
    ('CONFIG_ACESSO', 'permissoes:editar'),
    ('CONFIG_ACESSO', 'permissoes:excluir'),

    ('USUARIOS_ACESSO', 'usuarios:visualizar'),
    ('USUARIOS_ACESSO', 'usuarios:criar'),
    ('USUARIOS_ACESSO', 'usuarios:editar'),
    ('USUARIOS_ACESSO', 'usuarios:excluir'),

    ('EXECUCAO_OS_ACESSO', 'execucao_os:visualizar'),
    ('EXECUCAO_OS_ACESSO', 'execucao_os:editar')
)
insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, nova_perm.id
from public.perfilpermissao pp
join public.permissao legada_perm
  on legada_perm.id = pp.permissaoid
join mapa
  on mapa.legada = legada_perm.nome
join public.permissao nova_perm
  on nova_perm.nome = mapa.nova
on conflict do nothing;

with legadas(nome) as (
  values
    ('DASHBOARD_ACESSO'),
    ('CLIENTES_ACESSO'),
    ('ORDENS_ACESSO'),
    ('AGENDAMENTOS_ACESSO'),
    ('VEICULOS_ACESSO'),
    ('ESTOQUE_ACESSO'),
    ('VENDAS_ACESSO'),
    ('FINANCEIRO_ACESSO'),
    ('ACOMPANHAMENTO_ACESSO'),
    ('RELATORIOS_ACESSO'),
    ('CONFIG_ACESSO'),
    ('USUARIOS_ACESSO'),
    ('EXECUCAO_OS_ACESSO')
)
delete from public.perfilpermissao pp
using public.permissao p, legadas
where pp.permissaoid = p.id
  and p.nome = legadas.nome;

delete from public.permissao
where nome in (
  'DASHBOARD_ACESSO',
  'CLIENTES_ACESSO',
  'ORDENS_ACESSO',
  'AGENDAMENTOS_ACESSO',
  'VEICULOS_ACESSO',
  'ESTOQUE_ACESSO',
  'VENDAS_ACESSO',
  'FINANCEIRO_ACESSO',
  'ACOMPANHAMENTO_ACESSO',
  'RELATORIOS_ACESSO',
  'CONFIG_ACESSO',
  'USUARIOS_ACESSO',
  'EXECUCAO_OS_ACESSO'
);
