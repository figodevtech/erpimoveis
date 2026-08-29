-- Ordens importadas de sistemas legados existem somente para consulta historica.
-- A referencia torna a carga idempotente e o snapshot preserva o veiculo sem
-- obrigar a criacao de um cadastro operacional em public.veiculo.

alter table public.ordemservico
  add column if not exists migracao_referencia text,
  add column if not exists veiculo_snapshot jsonb;

alter table public.ordemservico
  drop constraint if exists ordemservico_migracao_referencia_nao_vazia,
  drop constraint if exists ordemservico_veiculo_snapshot_objeto,
  drop constraint if exists ordemservico_migracao_historica_consistente;

alter table public.ordemservico
  add constraint ordemservico_migracao_referencia_nao_vazia check (
    migracao_referencia is null or btrim(migracao_referencia) <> ''
  ),
  add constraint ordemservico_veiculo_snapshot_objeto check (
    veiculo_snapshot is null or jsonb_typeof(veiculo_snapshot) = 'object'
  ),
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
      and pagamento_concluido_em is null
    )
  );

create unique index if not exists ordemservico_migracao_referencia_uidx
  on public.ordemservico (migracao_referencia)
  where migracao_referencia is not null;

create index if not exists ordemservico_veiculo_snapshot_placa_idx
  on public.ordemservico ((upper(veiculo_snapshot ->> 'placa')))
  where veiculo_snapshot is not null;

comment on column public.ordemservico.migracao_referencia is
  'Identificador unico da OS no sistema legado. Preenchido somente em cargas historicas, sem efeitos operacionais ou financeiros.';

comment on column public.ordemservico.veiculo_snapshot is
  'Fotografia imutavel dos dados do veiculo informados na OS legada, inclusive quando veiculoid nao existe.';

-- A OS migrada e somente leitura. A excecao explicita existe apenas para uma
-- eventual manutencao administrativa transacional e nunca e usada pelo ERP.
create or replace function public.proteger_os_historica_migrada()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if old.migracao_referencia is not null
     and coalesce(current_setting('app.permitir_alterar_os_migrada', true), '') <> 'on' then
    raise exception 'A OS % e historica e somente leitura.', old.id
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_proteger_os_historica_migrada on public.ordemservico;
create trigger trg_proteger_os_historica_migrada
before update or delete on public.ordemservico
for each row
when (old.migracao_referencia is not null)
execute function public.proteger_os_historica_migrada();

-- Nenhum titulo, pagamento ou evento financeiro pode ser vinculado a uma OS
-- marcada como historica, mesmo que uma rota antiga tente faze-lo diretamente.
create or replace function public.impedir_financeiro_em_os_historica_migrada()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.ordemservicoid is not null
     and exists (
       select 1
         from public.ordemservico os
        where os.id = new.ordemservicoid
          and os.migracao_referencia is not null
     ) then
    raise exception 'A OS % e historica e nao aceita lancamentos financeiros.', new.ordemservicoid
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_impedir_transacao_os_historica on public.transacao;
create trigger trg_impedir_transacao_os_historica
before insert or update of ordemservicoid on public.transacao
for each row
when (new.ordemservicoid is not null)
execute function public.impedir_financeiro_em_os_historica_migrada();

drop trigger if exists trg_impedir_pagamento_os_historica on public.pagamento;
create trigger trg_impedir_pagamento_os_historica
before insert or update of ordemservicoid on public.pagamento
for each row
when (new.ordemservicoid is not null)
execute function public.impedir_financeiro_em_os_historica_migrada();

drop trigger if exists trg_impedir_evento_financeiro_os_historica on public.eventos_financeiros;
create trigger trg_impedir_evento_financeiro_os_historica
before insert or update of ordemservicoid on public.eventos_financeiros
for each row
when (new.ordemservicoid is not null)
execute function public.impedir_financeiro_em_os_historica_migrada();

-- A fila do Telegram trata qualquer INSERT como OS criada. Cargas historicas
-- nao podem gerar esse evento.
drop trigger if exists trg_registrar_evento_notificacao_os on public.ordemservico;
create trigger trg_registrar_evento_notificacao_os
after insert or update of status on public.ordemservico
for each row
when (new.migracao_referencia is null)
execute function public.fn_registrar_evento_notificacao_os();

revoke all on function public.proteger_os_historica_migrada() from public, anon, authenticated;
revoke all on function public.impedir_financeiro_em_os_historica_migrada() from public, anon, authenticated;

