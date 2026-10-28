-- O legado da BR Pecas exportou OS sem veiculo e itens sem codigo. A OS
-- historica passa a aceitar a ausencia dos dois: sem veiculo vinculado nem
-- snapshot, ou com snapshot identificado pela placa, como antes.

alter table public.ordemservico
  drop constraint if exists ordemservico_migracao_historica_consistente;

alter table public.ordemservico
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
      and (
        (veiculoid is null and veiculo_snapshot is null)
        or (
          veiculo_snapshot is not null
          and jsonb_typeof(veiculo_snapshot) = 'object'
          and coalesce(btrim(veiculo_snapshot ->> 'placa'), '') <> ''
        )
      )
      and coalesce(subtotal, 0) >= 0
      and coalesce(orcamentototal, 0) >= 0
      and coalesce(valor_frete, 0) = 0
      and coalesce(acrescimo_financeiro_valor, 0) = 0
      and (
        (desconto_tipo is null and coalesce(desconto, 0) = 0)
        or (
          desconto_tipo::text = 'FIXO'
          and coalesce(desconto, 0) >= 0
          and coalesce(desconto, 0) <= coalesce(subtotal, 0)
        )
      )
      and round(coalesce(orcamentototal, 0), 2)
        = round(coalesce(subtotal, 0) - coalesce(desconto, 0), 2)
      and forma_pagamento is null
      and parcelas_pagamento is null
      and pagamentos_previstos is null
      and dataentrada is not null
      and datasaida is not null
      and pagamento_concluido_em is not null
      and finalizado_em is not null
      and datasaida = dataentrada
      and pagamento_concluido_em = dataentrada
      and finalizado_em = dataentrada
    )
  );

comment on constraint ordemservico_migracao_historica_consistente
  on public.ordemservico is
  'OS historica concluida, sem cobranca operacional; o veiculo pode faltar, mas snapshot informado exige placa.';

-- O CHECK ositem_historico_codigo_legado_check (btrim <> '') continua barrando
-- texto vazio; nulo agora significa que o legado nao exportou o codigo.
alter table public.ositem_historico
  alter column codigo_legado drop not null;

comment on column public.ositem_historico.codigo_legado is
  'Codigo do item no sistema legado; nulo quando a exportacao nao o trouxe.';
