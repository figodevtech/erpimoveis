begin;

-- A consulta seguida de INSERT na API nao elimina corrida entre duas
-- requisicoes. Esta restricao torna a garantia atomica no PostgreSQL.
create or replace function public.agendamento_periodo(
  p_inicio timestamptz,
  p_fim timestamptz
)
returns tstzrange
language sql
immutable
set search_path = public
as $$
  select tstzrange(
    p_inicio,
    coalesce(p_fim, p_inicio + interval '1 minute'),
    '[)'
  )
$$;

revoke all on function public.agendamento_periodo(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.agendamento_periodo(timestamptz, timestamptz)
  to service_role;

alter table public.agendamento
  drop constraint if exists agendamento_periodo_ativo_excl;

alter table public.agendamento
  add constraint agendamento_periodo_ativo_excl
  exclude using gist (
    public.agendamento_periodo(inicio, fim) with &&
  )
  where (status not in ('RECUSADO', 'CANCELADO'));

commit;
