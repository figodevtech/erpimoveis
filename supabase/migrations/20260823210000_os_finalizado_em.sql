-- O encerramento operacional da OS nao e necessariamente um pagamento.
-- CONCLUIDO, SEM_COBRANCA e CANCELADO compartilham este marco; a conclusao
-- financeira continua registrada separadamente em pagamento_concluido_em.

alter table public.ordemservico
  add column if not exists finalizado_em timestamptz;

select set_config('app.permitir_alterar_os_migrada', 'on', false);

with datas_finais as (
  select os.id,
    coalesce(
      os.pagamento_concluido_em,
      (select max(a.ocorrido_em) from public.auditoria_evento a
        where a.tabela = 'ordemservico' and a.registro_id = os.id::text
          and a.dados_novos ->> 'status' = os.status::text
          and a.campos_alterados @> array['status']::text[]),
      (select max(e.created_at) from public.os_notificacao_evento e
        where e.ordemservico_id = os.id and e.status_novo = os.status::text),
      os.updatedat, os.dataentrada, now()
    ) finalizado_em
  from public.ordemservico os
  where os.status::text in ('CONCLUIDO', 'SEM_COBRANCA', 'CANCELADO')
)
update public.ordemservico os
   set finalizado_em = datas.finalizado_em
  from datas_finais datas
 where os.id = datas.id
   and os.finalizado_em is distinct from datas.finalizado_em;

select set_config('app.permitir_alterar_os_migrada', '', false);

create or replace function public.registrar_finalizacao_os()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_novo_final boolean := new.status::text in ('CONCLUIDO', 'SEM_COBRANCA', 'CANCELADO');
  v_antigo_final boolean := false;
begin
  if tg_op = 'INSERT' then
    new.finalizado_em := case when v_novo_final then coalesce(new.finalizado_em, now()) else null end;
    return new;
  end if;

  v_antigo_final := old.status::text in ('CONCLUIDO', 'SEM_COBRANCA', 'CANCELADO');
  if old.status is distinct from new.status then
    if v_novo_final then
      new.finalizado_em := case when v_antigo_final then now() else coalesce(new.finalizado_em, now()) end;
    elsif v_antigo_final then
      new.finalizado_em := null;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_registrar_finalizacao_os on public.ordemservico;
create trigger trg_registrar_finalizacao_os
before insert or update of status on public.ordemservico
for each row execute function public.registrar_finalizacao_os();

alter table public.ordemservico
  drop constraint if exists ordemservico_status_finalizado_em_consistente;
alter table public.ordemservico
  add constraint ordemservico_status_finalizado_em_consistente check (
    (status::text in ('CONCLUIDO', 'SEM_COBRANCA', 'CANCELADO') and finalizado_em is not null)
    or
    (coalesce(status::text, '') not in ('CONCLUIDO', 'SEM_COBRANCA', 'CANCELADO') and finalizado_em is null)
  );

create index if not exists ordemservico_status_finalizado_em_idx
  on public.ordemservico (status, finalizado_em desc, id desc);

alter table public.ordemservico
  drop constraint if exists ordemservico_migracao_historica_consistente;
alter table public.ordemservico
  add constraint ordemservico_migracao_historica_consistente check (
    migracao_referencia is null
    or (
      status::text = 'CONCLUIDO'
      and clienteid is not null
      and veiculo_snapshot is not null
      and jsonb_typeof(veiculo_snapshot) = 'object'
      and coalesce(btrim(veiculo_snapshot ->> 'placa'), '') <> ''
      and coalesce(orcamentototal, 0) = 0
      and coalesce(subtotal, 0) = 0
      and coalesce(valor_frete, 0) = 0
      and dataentrada is not null
      and datasaida is not null
      and pagamento_concluido_em is not null
      and finalizado_em is not null
      and datasaida = dataentrada
      and pagamento_concluido_em = dataentrada
      and finalizado_em = dataentrada
    )
  );

comment on column public.ordemservico.finalizado_em is
  'Instante em que a OS entrou no estado final CONCLUIDO, SEM_COBRANCA ou CANCELADO; independente de pagamento e saida fisica.';

revoke all on function public.registrar_finalizacao_os() from public, anon, authenticated;
