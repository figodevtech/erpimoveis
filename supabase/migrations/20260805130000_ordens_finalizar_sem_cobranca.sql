-- Permissao dedicada para concluir uma OS sem cobranca.
-- Antes qualquer perfil com 'ordens:editar' podia executar a operacao.
insert into public.permissao (nome, descricao)
values ('ordens:finalizar_sem_cobranca', 'Finalizar ordens de servico sem cobranca')
on conflict (nome) do update
set descricao = excluded.descricao;

-- Backfill: mantem o comportamento atual para quem ja edita ordens.
insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, nova.id
from public.perfilpermissao pp
join public.permissao base on base.id = pp.permissaoid and base.nome = 'ordens:editar'
join public.permissao nova on nova.nome = 'ordens:finalizar_sem_cobranca'
on conflict do nothing;
