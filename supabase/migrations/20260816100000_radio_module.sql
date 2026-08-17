-- Catalogo e preferencias do player de radio do ERP.
-- O audio nunca passa pelo banco nem pelo servidor do ERP: armazenamos apenas
-- os enderecos que o navegador consumira diretamente.

create table if not exists public.radio_station (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  frequency text,
  city text,
  state text,
  country text not null default 'Brasil',
  neighborhood text,
  description text,
  genres text[] not null default '{}'::text[],
  logo_url text,
  website_url text,
  source_page text,
  stream_url text,
  playlist_url text,
  playlist_format text check (playlist_format is null or playlist_format in ('M3U', 'M3U8', 'PLS')),
  stream_type text check (stream_type is null or stream_type in ('DIRECT_STREAM', 'HLS')),
  codec text,
  bitrate integer check (bitrate is null or bitrate > 0),
  stream_status text not null default 'UNKNOWN'
    check (stream_status in ('ONLINE', 'OFFLINE', 'UNKNOWN', 'INVALID', 'PLAYLIST_FOUND', 'RESOLVING')),
  last_checked_at timestamptz,
  last_online_at timestamptz,
  active boolean not null default true,
  system_default boolean not null default false,
  company_id integer references public.empresa(id) on delete cascade,
  created_by_id uuid references public.usuario(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint radio_station_system_scope_check
    check (not system_default or company_id is null),
  constraint radio_station_source_check
    check (not active or stream_url is not null or playlist_url is not null)
);

-- O NULL de company_id representa o catalogo global, por isso cada escopo
-- precisa de um indice parcial proprio para manter a importacao idempotente.
create unique index if not exists radio_station_global_slug_uidx
  on public.radio_station (slug)
  where company_id is null;

create unique index if not exists radio_station_company_slug_uidx
  on public.radio_station (company_id, slug)
  where company_id is not null;

create unique index if not exists radio_station_global_stream_uidx
  on public.radio_station (lower(stream_url))
  where company_id is null and stream_url is not null;

create unique index if not exists radio_station_company_stream_uidx
  on public.radio_station (company_id, lower(stream_url))
  where company_id is not null and stream_url is not null;

create unique index if not exists radio_station_global_playlist_uidx
  on public.radio_station (lower(playlist_url))
  where company_id is null and playlist_url is not null;

create unique index if not exists radio_station_company_playlist_uidx
  on public.radio_station (company_id, lower(playlist_url))
  where company_id is not null and playlist_url is not null;

create index if not exists radio_station_catalog_idx
  on public.radio_station (company_id, active, system_default desc, name);

create index if not exists radio_station_genres_idx
  on public.radio_station using gin (genres);

create table if not exists public.radio_favorite (
  user_id uuid not null references public.usuario(id) on delete cascade,
  station_id uuid not null references public.radio_station(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, station_id)
);

create index if not exists radio_favorite_station_idx
  on public.radio_favorite (station_id);

create or replace function public.set_radio_station_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_radio_station_updated_at on public.radio_station;
create trigger trg_radio_station_updated_at
before update on public.radio_station
for each row execute function public.set_radio_station_updated_at();

alter table public.radio_station enable row level security;
alter table public.radio_station no force row level security;
alter table public.radio_favorite enable row level security;
alter table public.radio_favorite no force row level security;

revoke all on table public.radio_station from public, anon, authenticated;
revoke all on table public.radio_favorite from public, anon, authenticated;
grant select, insert, update, delete on table public.radio_station to service_role;
grant select, insert, update, delete on table public.radio_favorite to service_role;

revoke all on function public.set_radio_station_updated_at() from public, anon, authenticated;

insert into public.permissao (nome, descricao)
values
  ('radios:visualizar', 'Visualizar e reproduzir o catalogo de radios'),
  ('radios:criar', 'Cadastrar radios da empresa'),
  ('radios:editar', 'Editar e testar radios da empresa'),
  ('radios:excluir', 'Excluir radios da empresa')
on conflict (nome) do update
set descricao = excluded.descricao;

-- O player nasce disponivel para os perfis que ja acessam o dashboard. Perfis
-- exclusivos de execucao continuam exclusivos e nao ganham acesso lateral.
insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, nova.id
from public.perfilpermissao pp
join public.permissao base on base.id = pp.permissaoid and base.nome = 'dashboard:visualizar'
join public.permissao nova on nova.nome = 'radios:visualizar'
on conflict do nothing;

-- Administracao de radios acompanha a permissao de editar configuracoes.
insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, nova.id
from public.perfilpermissao pp
join public.permissao base on base.id = pp.permissaoid and base.nome = 'configuracoes:editar'
join public.permissao nova on nova.nome in (
  'radios:visualizar', 'radios:criar', 'radios:editar', 'radios:excluir'
)
on conflict do nothing;

comment on table public.radio_station is
  'Catalogo global (company_id null) e radios privadas da empresa. source_page nunca e tratada como stream.';
comment on table public.radio_favorite is
  'Favoritos pessoais; o acesso ao escopo da estacao e sempre validado na API.';
