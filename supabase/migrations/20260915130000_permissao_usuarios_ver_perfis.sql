-- Permissao dedicada para ver o perfil de outros usuarios em /meu-perfil.
-- Antes a navegacao entre perfis, e a troca de foto do perfil escolhido, vinham
-- de 'usuarios:visualizar', que tambem abre o cadastro de usuarios com salario
-- e comissoes. Separadas, da para liberar uma sem a outra.
insert into public.permissao (nome, descricao)
values ('usuarios:ver-perfis', 'Ver o perfil de outros usuarios em Meu Perfil e trocar a foto deles')
on conflict (nome) do update
set descricao = excluded.descricao;

-- Backfill: mantem o comportamento atual para quem ja visualiza usuarios.
insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, nova.id
from public.perfilpermissao pp
join public.permissao base on base.id = pp.permissaoid and base.nome = 'usuarios:visualizar'
join public.permissao nova on nova.nome = 'usuarios:ver-perfis'
on conflict do nothing;
