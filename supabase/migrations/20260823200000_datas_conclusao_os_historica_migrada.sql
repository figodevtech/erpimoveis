-- A data disponivel na exportacao legada representa o atendimento historico.
-- Para as OS migradas, entrada, saida e conclusao devem registrar esse mesmo
-- instante, sem criar pagamento ou qualquer outro efeito financeiro.

alter table public.ordemservico
  drop constraint if exists ordemservico_migracao_historica_consistente;

set app.permitir_alterar_os_migrada = 'on';

update public.ordemservico
   set datasaida = dataentrada,
       pagamento_concluido_em = dataentrada
 where migracao_referencia is not null
   and (
     datasaida is distinct from dataentrada
     or pagamento_concluido_em is distinct from dataentrada
   );

reset app.permitir_alterar_os_migrada;

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
      and datasaida = dataentrada
      and pagamento_concluido_em = dataentrada
    )
  );

comment on constraint ordemservico_migracao_historica_consistente on public.ordemservico is
  'OS historica concluida, sem cobranca, com entrada, saida e conclusao na mesma data legada.';
