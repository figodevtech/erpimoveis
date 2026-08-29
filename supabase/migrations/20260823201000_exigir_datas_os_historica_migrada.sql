-- CHECK considera expressoes NULL como validas. Exigir a presenca das datas
-- explicitamente impede que uma OS historica concluida fique sem os marcos.

alter table public.ordemservico
  drop constraint if exists ordemservico_migracao_historica_consistente;

select set_config('app.permitir_alterar_os_migrada', 'on', false);

insert into public.os_saida (
  ordemservico_id,
  saida_em,
  retirado_por,
  documento_observacao,
  registrado_por,
  created_by,
  created_at,
  updated_at
)
select
  os.id,
  os.dataentrada,
  'Registro historico migrado',
  'Saida registrada a partir do historico do sistema legado.',
  coalesce(os.usuariocriadorid, os.created_by),
  coalesce(os.created_by, os.usuariocriadorid),
  os.dataentrada,
  os.dataentrada
from public.ordemservico os
where os.migracao_referencia is not null
on conflict (ordemservico_id) do nothing;

update public.ordemservico
   set datasaida = dataentrada,
       pagamento_concluido_em = dataentrada
 where migracao_referencia is not null;

select set_config('app.permitir_alterar_os_migrada', '', false);

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
      and datasaida = dataentrada
      and pagamento_concluido_em = dataentrada
    )
  );

comment on constraint ordemservico_migracao_historica_consistente on public.ordemservico is
  'OS historica concluida, sem cobranca, com entrada, saida e conclusao obrigatorias e na mesma data legada.';
