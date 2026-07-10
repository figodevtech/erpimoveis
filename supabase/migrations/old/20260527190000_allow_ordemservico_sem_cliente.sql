alter table public.ordemservico
alter column clienteid drop not null;

alter table public.peca
alter column clienteid drop not null;
