alter table public.agendamento
drop constraint if exists agendamento_status_check;

update public.agendamento
set status = case
  when status in ('CONFIRMADO', 'EM_ATENDIMENTO', 'CONCLUIDO') then 'AGENDADO'
  when status = 'REPROVADO' then 'RECUSADO'
  else status
end
where status in ('CONFIRMADO', 'EM_ATENDIMENTO', 'CONCLUIDO', 'REPROVADO');

alter table public.agendamento
add constraint agendamento_status_check
check (status in (
  'PENDENTE_APROVACAO',
  'AGENDADO',
  'RECUSADO',
  'CANCELADO'
));

alter table public.agendamento
add column if not exists origem text not null default 'ERP',
add column if not exists motivorecusa text,
add column if not exists mensagemnotificacao text,
add column if not exists canalnotificacao text,
add column if not exists notificadoat timestamp with time zone,
add column if not exists decisaoat timestamp with time zone,
add column if not exists decisorusuarioid uuid references public.usuario(id) on delete set null,
add column if not exists solicitante_nome text,
add column if not exists solicitante_cpfcnpj text,
add column if not exists solicitante_telefone text,
add column if not exists solicitante_email text;

alter table public.agendamento
drop constraint if exists agendamento_origem_check;

alter table public.agendamento
add constraint agendamento_origem_check
check (origem in ('ERP', 'SITE'));

create index if not exists idx_agendamento_origem_status_inicio
on public.agendamento (origem, status, inicio);

drop index if exists public.agendamento_inicio_unique;

create unique index if not exists agendamento_inicio_ativo_unique
on public.agendamento (inicio)
where status not in ('RECUSADO', 'CANCELADO');
