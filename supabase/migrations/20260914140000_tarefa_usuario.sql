begin;

-- Tabela pessoal para tarefas, notas e lembretes de cada usuário
create table if not exists public.tarefa_usuario (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  tipo text not null default 'TAREFA',
  titulo text not null,
  descricao text,
  status text not null default 'ABERTA',
  prioridade text not null default 'NORMAL',
  data_prevista date,
  lembrete_em timestamptz,
  fixada boolean not null default false,
  ordem integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint tarefa_usuario_tipo_check check (tipo in ('TAREFA', 'NOTA')),
  constraint tarefa_usuario_titulo_check check (length(btrim(titulo)) between 1 and 255),
  constraint tarefa_usuario_status_check check (status in ('ABERTA', 'CONCLUIDA')),
  constraint tarefa_usuario_prioridade_check check (prioridade in ('BAIXA', 'NORMAL', 'ALTA'))
);

create index if not exists tarefa_usuario_usuario_id_idx
  on public.tarefa_usuario(usuario_id);

create index if not exists tarefa_usuario_usuario_status_idx
  on public.tarefa_usuario(usuario_id, status, fixada desc, data_prevista asc nulls last, created_at desc);

create index if not exists tarefa_usuario_usuario_tipo_idx
  on public.tarefa_usuario(usuario_id, tipo, fixada desc, created_at desc);

create index if not exists tarefa_usuario_usuario_data_prevista_idx
  on public.tarefa_usuario(usuario_id, data_prevista)
  where status = 'ABERTA';

create or replace function public.set_tarefa_usuario_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all on function public.set_tarefa_usuario_updated_at() from public, anon, authenticated;

drop trigger if exists trg_tarefa_usuario_updated_at on public.tarefa_usuario;
create trigger trg_tarefa_usuario_updated_at
before update on public.tarefa_usuario
for each row execute function public.set_tarefa_usuario_updated_at();

alter table public.tarefa_usuario enable row level security;
alter table public.tarefa_usuario no force row level security;

revoke all on table public.tarefa_usuario from public, anon;
grant select, insert, update, delete on table public.tarefa_usuario to authenticated, service_role;

drop policy if exists tarefa_usuario_select_own on public.tarefa_usuario;
create policy tarefa_usuario_select_own on public.tarefa_usuario
  for select to authenticated using (usuario_id = auth.uid());

drop policy if exists tarefa_usuario_insert_own on public.tarefa_usuario;
create policy tarefa_usuario_insert_own on public.tarefa_usuario
  for insert to authenticated with check (usuario_id = auth.uid());

drop policy if exists tarefa_usuario_update_own on public.tarefa_usuario;
create policy tarefa_usuario_update_own on public.tarefa_usuario
  for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists tarefa_usuario_delete_own on public.tarefa_usuario;
create policy tarefa_usuario_delete_own on public.tarefa_usuario
  for delete to authenticated using (usuario_id = auth.uid());

comment on table public.tarefa_usuario is
  'Espaço pessoal do usuário para tarefas, notas e lembretes privados.';
comment on column public.tarefa_usuario.usuario_id is
  'Proprietário do registro; isolado via RLS (usuario_id = auth.uid()).';

commit;
