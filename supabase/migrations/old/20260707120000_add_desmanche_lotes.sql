insert into public.permissao (nome, descricao)
values
  ('desmanche:visualizar', 'Visualizar modulo de desmanche'),
  ('desmanche:criar', 'Criar lotes de desmanche'),
  ('desmanche:editar', 'Editar lotes de desmanche'),
  ('desmanche:excluir', 'Excluir lotes de desmanche')
on conflict (nome) do update
set descricao = excluded.descricao;

insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, p_desmanche.id
from public.perfilpermissao pp
join public.permissao p_base
  on p_base.id = pp.permissaoid
 and p_base.nome in ('veiculos:visualizar', 'estoque:visualizar')
cross join public.permissao p_desmanche
where p_desmanche.nome = 'desmanche:visualizar'
on conflict do nothing;

insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, p_desmanche.id
from public.perfilpermissao pp
join public.permissao p_base
  on p_base.id = pp.permissaoid
 and p_base.nome in ('veiculos:criar', 'estoque:criar')
cross join public.permissao p_desmanche
where p_desmanche.nome = 'desmanche:criar'
on conflict do nothing;

insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, p_desmanche.id
from public.perfilpermissao pp
join public.permissao p_base
  on p_base.id = pp.permissaoid
 and p_base.nome in ('veiculos:editar', 'estoque:editar')
cross join public.permissao p_desmanche
where p_desmanche.nome = 'desmanche:editar'
on conflict do nothing;

insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, p_desmanche.id
from public.perfilpermissao pp
join public.permissao p_base
  on p_base.id = pp.permissaoid
 and p_base.nome in ('veiculos:excluir', 'estoque:excluir')
cross join public.permissao p_desmanche
where p_desmanche.nome = 'desmanche:excluir'
on conflict do nothing;

create table if not exists public.lotes (
  id integer generated always as identity primary key,
  placa varchar unique,
  modelo text,
  marca text,
  ano integer,
  cor varchar,
  kmatual integer,
  tipo text,
  chassi text,
  ano_modelo integer,
  versao text,
  fipe numeric,
  combustivel text,
  transmissao text,
  observacoes text,
  createdat timestamp with time zone not null default now(),
  updatedat timestamp with time zone not null default now()
);

create table if not exists public.lote_pecas (
  id integer generated always as identity primary key,
  lote_id integer not null references public.lotes(id) on delete cascade,
  produto_id integer not null references public.produto(id) on delete cascade,
  createdat timestamp with time zone not null default now(),
  updatedat timestamp with time zone not null default now(),
  constraint lote_pecas_produto_id_key unique (produto_id),
  constraint lote_pecas_lote_produto_key unique (lote_id, produto_id)
);

create index if not exists idx_lotes_placa on public.lotes (placa);
create index if not exists idx_lote_pecas_lote_id on public.lote_pecas (lote_id);

create or replace function public.set_lotes_updatedat()
returns trigger
language plpgsql
as $$
begin
  new.updatedat = now();
  return new;
end;
$$;

drop trigger if exists trg_lotes_updatedat on public.lotes;
create trigger trg_lotes_updatedat
before update on public.lotes
for each row
execute function public.set_lotes_updatedat();

create or replace function public.set_lote_pecas_updatedat()
returns trigger
language plpgsql
as $$
begin
  new.updatedat = now();
  return new;
end;
$$;

drop trigger if exists trg_lote_pecas_updatedat on public.lote_pecas;
create trigger trg_lote_pecas_updatedat
before update on public.lote_pecas
for each row
execute function public.set_lote_pecas_updatedat();

grant all on table public.lotes to anon;
grant all on table public.lotes to authenticated;
grant all on table public.lotes to service_role;
grant all on sequence public.lotes_id_seq to anon;
grant all on sequence public.lotes_id_seq to authenticated;
grant all on sequence public.lotes_id_seq to service_role;

grant all on table public.lote_pecas to anon;
grant all on table public.lote_pecas to authenticated;
grant all on table public.lote_pecas to service_role;
grant all on sequence public.lote_pecas_id_seq to anon;
grant all on sequence public.lote_pecas_id_seq to authenticated;
grant all on sequence public.lote_pecas_id_seq to service_role;
