-- Preferencias pessoais do usuario. Esta tabela e independente das permissoes
-- administrativas: uma preferencia pode ocultar um recurso, mas nunca libera-lo.

create table if not exists public.usuario_preferencia (
  usuario_id uuid primary key references public.usuario(id) on delete cascade,
  radio_habilitado boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_usuario_preferencia_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_usuario_preferencia_updated_at on public.usuario_preferencia;
create trigger trg_usuario_preferencia_updated_at
before update on public.usuario_preferencia
for each row execute function public.set_usuario_preferencia_updated_at();

alter table public.usuario_preferencia enable row level security;
alter table public.usuario_preferencia no force row level security;

revoke all on table public.usuario_preferencia from public, anon, authenticated;
grant select, insert, update, delete on table public.usuario_preferencia to service_role;

revoke all on function public.set_usuario_preferencia_updated_at() from public, anon, authenticated;

comment on table public.usuario_preferencia is
  'Preferencias pessoais editaveis somente pelo proprio usuario atraves da API /api/me/preferencias.';
comment on column public.usuario_preferencia.radio_habilitado is
  'Escolha pessoal de exibir o player; nao substitui a permissao radios:visualizar.';
