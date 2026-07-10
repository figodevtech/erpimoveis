alter table public.empresa
  add column if not exists placa_consulta_limite_mensal integer not null default 100,
  add column if not exists placa_consulta_qtd_mes integer not null default 0,
  add column if not exists placa_consulta_mes text not null default to_char(timezone('America/Sao_Paulo', now()), 'YYYY-MM');

alter table public.empresa
  add constraint empresa_placa_consulta_limite_mensal_chk
  check (placa_consulta_limite_mensal >= 0) not valid;

alter table public.empresa
  add constraint empresa_placa_consulta_qtd_mes_chk
  check (placa_consulta_qtd_mes >= 0) not valid;

alter table public.empresa
  validate constraint empresa_placa_consulta_limite_mensal_chk;

alter table public.empresa
  validate constraint empresa_placa_consulta_qtd_mes_chk;

create or replace function public.registrar_consulta_placa_empresa(p_empresa_id integer default null)
returns table (
  permitido boolean,
  empresa_id integer,
  limite integer,
  usadas integer,
  mes text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa_id integer;
  v_mes text := to_char(timezone('America/Sao_Paulo', now()), 'YYYY-MM');
begin
  select e.id
    into v_empresa_id
    from public.empresa e
   where p_empresa_id is null or e.id = p_empresa_id
   order by e.id
   limit 1
   for update;

  if v_empresa_id is null then
    return;
  end if;

  update public.empresa e
     set placa_consulta_qtd_mes = case
           when e.placa_consulta_mes <> v_mes then 0
           else e.placa_consulta_qtd_mes
         end,
         placa_consulta_mes = v_mes
   where e.id = v_empresa_id;

  return query
  update public.empresa e
     set placa_consulta_qtd_mes = e.placa_consulta_qtd_mes + 1,
         updatedat = now()
   where e.id = v_empresa_id
     and e.placa_consulta_qtd_mes < e.placa_consulta_limite_mensal
   returning
     true,
     e.id,
     e.placa_consulta_limite_mensal,
     e.placa_consulta_qtd_mes,
     e.placa_consulta_mes;

  if not found then
    return query
    select
      false,
      e.id,
      e.placa_consulta_limite_mensal,
      e.placa_consulta_qtd_mes,
      e.placa_consulta_mes
    from public.empresa e
    where e.id = v_empresa_id;
  end if;
end;
$$;

grant execute on function public.registrar_consulta_placa_empresa(integer) to service_role;
