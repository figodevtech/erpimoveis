-- Configuracoes gerais mantem permissoes proprias. Cada cadastro de Tipos
-- ganha acesso e operacoes independentes.
insert into public.permissao (nome, descricao)
values
  ('configuracoes:criar', 'Criar registros das configuracoes gerais'),
  ('configuracoes:excluir', 'Excluir registros das configuracoes gerais'),
  ('tipos:visualizar', 'Acessar a pagina de Tipos')
on conflict (nome) do update set descricao = excluded.descricao;

with tipos(id, titulo) as (
  values
    ('grupos', 'grupos de produtos'),
    ('grupos_usoconsumo', 'grupos de uso e consumo'),
    ('unidades', 'unidades de medida'),
    ('servicos', 'servicos'),
    ('fornecedores', 'fornecedores'),
    ('setores', 'setores'),
    ('bancos', 'contas bancarias'),
    ('categorias', 'categorias de transacao'),
    ('bandeiras', 'bandeiras de cartao'),
    ('planos_conta', 'planos de conta'),
    ('centros_custo', 'centros de custo'),
    ('categorias_venda', 'categorias de venda'),
    ('cores_veiculos', 'cores de veiculos'),
    ('tipos_entrada', 'motivos de entrada'),
    ('motivos_saida', 'motivos de saida')
), acoes(id, titulo) as (
  values
    ('visualizar', 'Visualizar'),
    ('criar', 'Criar'),
    ('editar', 'Editar'),
    ('excluir', 'Excluir')
)
insert into public.permissao (nome, descricao)
select 'tipos:' || tipos.id || ':' || acoes.id,
       acoes.titulo || ' ' || tipos.titulo
from tipos cross join acoes
on conflict (nome) do update set descricao = excluded.descricao;

-- Preserva o acesso dos perfis existentes. Depois do backfill, cada permissao
-- pode ser removida no editor de perfis sem afetar os outros cadastros.
insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, nova.id
from public.perfilpermissao pp
join public.permissao antiga on antiga.id = pp.permissaoid
join public.permissao nova on (
  (antiga.nome = 'configuracoes:visualizar' and
    (nova.nome = 'tipos:visualizar' or nova.nome like 'tipos:%:visualizar'))
  or
  (antiga.nome = 'configuracoes:editar' and
    (nova.nome in ('configuracoes:criar', 'configuracoes:excluir', 'tipos:visualizar')
     or nova.nome like 'tipos:%:%'))
)
where antiga.nome in ('configuracoes:visualizar', 'configuracoes:editar')
on conflict do nothing;
