-- O player de radio passa a ser um recurso que o usuario liga por escolha
-- propria. O padrao da coluna vira falso e todas as linhas existentes ficam
-- desligadas, inclusive as dos usuarios que nunca abriram Preferencias.

alter table public.usuario_preferencia
  alter column radio_habilitado set default false;

update public.usuario_preferencia
set radio_habilitado = false
where radio_habilitado;

-- Uma linha por usuario deixa a preferencia desligada explicita e independente
-- do padrao da coluna.
insert into public.usuario_preferencia (usuario_id, radio_habilitado)
select u.id, false
from public.usuario u
on conflict (usuario_id) do nothing;

comment on column public.usuario_preferencia.radio_habilitado is
  'Escolha pessoal de exibir o player, desligada por padrao; nao substitui a permissao radios:visualizar.';
