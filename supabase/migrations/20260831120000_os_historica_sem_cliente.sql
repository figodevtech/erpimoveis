-- OS historica pode preservar a pessoa informada no legado sem criar um
-- cliente operacional incompleto ou atribuir a OS ao proprietario atual do
-- veiculo. O snapshot e informativo e nao participa de financeiro/fiscal.

alter table public.ordemservico
  add column if not exists cliente_snapshot jsonb;

alter table public.ordemservico
  drop constraint if exists ordemservico_cliente_snapshot_objeto,
  drop constraint if exists ordemservico_migracao_historica_consistente;

alter table public.ordemservico
  add constraint ordemservico_cliente_snapshot_objeto check (
    cliente_snapshot is null or jsonb_typeof(cliente_snapshot) = 'object'
  ),
  add constraint ordemservico_migracao_historica_consistente check (
    migracao_referencia is null
    or (
      status::text = 'CONCLUIDO'
      and (
        clienteid is not null
        or (
          cliente_snapshot is not null
          and jsonb_typeof(cliente_snapshot) = 'object'
          and coalesce(btrim(cliente_snapshot ->> 'nome'), '') <> ''
        )
      )
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

comment on column public.ordemservico.cliente_snapshot is
  'Dados informativos do cliente no sistema legado quando a OS historica nao possui clienteid; nao cria vinculo operacional, financeiro ou fiscal.';

comment on constraint ordemservico_migracao_historica_consistente on public.ordemservico is
  'OS historica concluida e sem cobranca; aceita cliente cadastrado ou snapshot legado identificado por nome.';
