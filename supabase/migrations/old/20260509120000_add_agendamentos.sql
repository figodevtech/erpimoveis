insert into public.permissao (nome, descricao)
values ('AGENDAMENTOS_ACESSO', 'Acesso ao modulo de agendamentos')
on conflict (nome) do update
set descricao = excluded.descricao;

insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, p_agendamento.id
from public.perfilpermissao pp
join public.permissao p_ordens
  on p_ordens.id = pp.permissaoid
 and p_ordens.nome = 'ORDENS_ACESSO'
cross join public.permissao p_agendamento
where p_agendamento.nome = 'AGENDAMENTOS_ACESSO'
on conflict do nothing;

create table if not exists public.agendamento (
  id integer generated always as identity primary key,
  clienteid integer not null references public.cliente(id) on delete restrict,
  veiculoid integer references public.veiculo(id) on delete set null,
  ordemservicoid integer references public.ordemservico(id) on delete set null,
  usuarioid uuid references public.usuario(id) on delete set null,
  titulo text not null,
  descricao text,
  inicio timestamp with time zone not null,
  fim timestamp with time zone,
  status text not null default 'AGENDADO',
  observacoes text,
  createdat timestamp with time zone not null default now(),
  updatedat timestamp with time zone not null default now(),
  constraint agendamento_status_check
    check (status in ('AGENDADO', 'CONFIRMADO', 'EM_ATENDIMENTO', 'CONCLUIDO', 'CANCELADO')),
  constraint agendamento_periodo_check
    check (fim is null or fim > inicio)
);

create index if not exists idx_agendamento_inicio
on public.agendamento (inicio);

create index if not exists idx_agendamento_status_inicio
on public.agendamento (status, inicio);

create index if not exists idx_agendamento_cliente
on public.agendamento (clienteid);

create or replace function public.set_agendamento_updatedat()
returns trigger
language plpgsql
as $$
begin
  new.updatedat = now();
  return new;
end;
$$;

drop trigger if exists trg_agendamento_updatedat on public.agendamento;
create trigger trg_agendamento_updatedat
before update on public.agendamento
for each row
execute function public.set_agendamento_updatedat();

grant all on table public.agendamento to anon;
grant all on table public.agendamento to authenticated;
grant all on table public.agendamento to service_role;
grant all on sequence public.agendamento_id_seq to anon;
grant all on sequence public.agendamento_id_seq to authenticated;
grant all on sequence public.agendamento_id_seq to service_role;

alter table public.config_geral
add column if not exists agendamento_intervalo_minutos integer not null default 60,
add column if not exists agendamento_hora_inicio time without time zone not null default '08:00',
add column if not exists agendamento_hora_fim time without time zone not null default '18:00',
add column if not exists agendamento_dias_trabalho integer[] not null default array[1,2,3,4,5];

alter table public.config_geral
drop constraint if exists config_geral_agendamento_intervalo_chk;

alter table public.config_geral
add constraint config_geral_agendamento_intervalo_chk
check (agendamento_intervalo_minutos in (15, 30, 45, 60, 90, 120, 180, 240));

alter table public.config_geral
drop constraint if exists config_geral_agendamento_horario_chk;

alter table public.config_geral
add constraint config_geral_agendamento_horario_chk
check (agendamento_hora_fim > agendamento_hora_inicio);

alter table public.config_geral
drop constraint if exists config_geral_agendamento_dias_chk;

alter table public.config_geral
add constraint config_geral_agendamento_dias_chk
check (
  array_length(agendamento_dias_trabalho, 1) >= 1
  and agendamento_dias_trabalho <@ array[0,1,2,3,4,5,6]
);
