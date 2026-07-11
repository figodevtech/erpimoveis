alter table public.agendamento
drop column if exists ordemservicoid,
drop column if exists observacoes;

create unique index if not exists agendamento_inicio_unique
on public.agendamento (inicio);
