-- Itens de orcamento vindos do sistema legado sao somente informativos.
-- Eles nao pertencem ao catalogo operacional e nao movimentam estoque,
-- comissao, financeiro ou fiscal.

create table if not exists public.ositem_historico (
  id bigint generated always as identity primary key,
  ordemservicoid integer not null
    references public.ordemservico(id) on delete cascade,
  origem text not null,
  linha_origem integer not null check (linha_origem > 1),
  tipo text not null check (tipo in ('PRODUTO', 'SERVICO')),
  codigo_legado text not null check (btrim(codigo_legado) <> ''),
  descricao text not null check (btrim(descricao) <> ''),
  unidade text,
  quantidade numeric(14,4) not null check (quantidade > 0),
  preco_unitario numeric(14,4) not null check (preco_unitario >= 0),
  subtotal numeric(14,2) not null check (
    subtotal >= 0
    and subtotal = round(quantidade * preco_unitario, 2)
  ),
  created_at timestamptz not null default now(),
  unique (origem, ordemservicoid, linha_origem)
);

create index if not exists ositem_historico_ordem_tipo_idx
  on public.ositem_historico (ordemservicoid, tipo, linha_origem);

alter table public.ositem_historico enable row level security;
alter table public.ositem_historico no force row level security;
revoke all on table public.ositem_historico from anon, authenticated;
grant select, insert, update, delete on table public.ositem_historico to service_role;
grant usage, select on sequence public.ositem_historico_id_seq to service_role;

create or replace function public.validar_ositem_historico()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE')
     and coalesce(current_setting('app.permitir_alterar_os_migrada', true), '') <> 'on' then
    raise exception 'Itens de OS historica sao somente leitura.'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if not exists (
    select 1
      from public.ordemservico os
     where os.id = new.ordemservicoid
       and os.migracao_referencia is not null
       and os.status::text = 'CONCLUIDO'
  ) then
    raise exception 'O item historico exige uma OS migrada e concluida.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_validar_ositem_historico
  on public.ositem_historico;
create trigger trg_validar_ositem_historico
before insert or update or delete on public.ositem_historico
for each row execute function public.validar_ositem_historico();

revoke all on function public.validar_ositem_historico()
  from public, anon, authenticated;

-- O valor e exibido no orcamento, mas nao representa uma conta a receber.
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
      and veiculo_snapshot is not null
      and jsonb_typeof(veiculo_snapshot) = 'object'
      and coalesce(btrim(veiculo_snapshot ->> 'placa'), '') <> ''
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

comment on table public.ositem_historico is
  'Snapshot dos produtos e servicos informados em orcamentos de OS migradas; nao integra catalogo, estoque, comissao, financeiro ou fiscal.';

comment on constraint ordemservico_migracao_historica_consistente
  on public.ordemservico is
  'OS historica concluida, sem cobranca operacional; o orcamento pode conter valores apenas informativos.';

-- Alterar o total de uma OS historica nao pode criar os eventos de frete ou
-- desconto que alimentam a DRE das OS operacionais.
drop trigger if exists trg_ajustar_eventos_frete_os
  on public.ordemservico;
create trigger trg_ajustar_eventos_frete_os
after update of status, orcamentototal, valor_frete on public.ordemservico
for each row
when (new.migracao_referencia is null)
execute function public.tg_ajustar_eventos_frete_os();
