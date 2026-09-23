-- Ver no fluxo de caixa o que os outros lancaram.
--
-- O PROBLEMA
-- `financeiro:visualizar` era tudo ou nada: quem entrava na tela via o caixa
-- inteiro da oficina. Nao havia como dar acesso ao financeiro a uma pessoa e
-- mostrar a ela so o proprio trabalho.
--
-- A REGRA
-- A permissao e aditiva, como todas as outras do sistema: quem a tem ve tudo,
-- quem nao a tem ve o que criou mais o que nao tem dono. O inverso -- uma
-- permissao que restringe -- faria esquecer de conceder abrir o caixa, e um
-- perfil novo nasceria com acesso total por omissao.
--
-- `created_by IS NULL` fica visivel de proposito. A coluna so passou a ser
-- gravada em todos os caminhos agora; dar dono ao passado faria o historico
-- sumir da tela de todo mundo de uma vez. O recorte aperta sozinho, conforme os
-- lancamentos novos nascem com autor.

insert into public.permissao (nome, descricao)
values ('financeiro:ver_todas_transacoes',
        'Ver no fluxo de caixa as transacoes criadas por outras pessoas')
on conflict (nome) do update
set descricao = excluded.descricao;

-- Backfill: ninguem perde acesso hoje. Quem ja ve o financeiro continua vendo
-- tudo; sao os perfis NOVOS que nascem com o recorte.
insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, nova.id
from public.perfilpermissao pp
join public.permissao base on base.id = pp.permissaoid
                          and base.nome = 'financeiro:visualizar'
join public.permissao nova on nova.nome = 'financeiro:ver_todas_transacoes'
on conflict do nothing;

-- Indice cheio, nao parcial. O filtro e `created_by = <uid> OR created_by IS
-- NULL`, e o btree do Postgres indexa NULL: um `where created_by is not null`
-- -- como o transacao_baixado_por_idx -- deixaria de fora justamente o ramo
-- que hoje responde pela maioria das linhas.
create index if not exists transacao_created_by_idx
  on public.transacao (created_by);
