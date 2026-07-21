-- Estrutura aditiva para rentabilidade por ordem de servico.
-- Dados antigos permanecem sem snapshot e serao identificados como estimados.

alter table public.produto
  add column if not exists ultimovalordecompra numeric(14,2);

alter table public.osproduto
  add column if not exists custo_unitario_aplicado numeric(14,2);

alter table public.produto
  drop constraint if exists produto_ultimovalordecompra_nonnegative;
alter table public.produto
  add constraint produto_ultimovalordecompra_nonnegative
  check (ultimovalordecompra is null or ultimovalordecompra >= 0) not valid;

alter table public.osproduto
  drop constraint if exists osproduto_custo_unitario_aplicado_nonnegative;
alter table public.osproduto
  add constraint osproduto_custo_unitario_aplicado_nonnegative
  check (custo_unitario_aplicado is null or custo_unitario_aplicado >= 0) not valid;

-- Uma conta a pagar pode nascer sem conta bancaria. A conta sera informada na baixa.
alter table public.transacao
  alter column banco_id drop not null,
  alter column metodopagamento drop not null;

create index if not exists idx_transacao_os_tipo_pendente
  on public.transacao (ordemservicoid, tipo, pendente)
  where ordemservicoid is not null and is_deleted = false;

create or replace function public.fn_osproduto_snapshot_ultimo_custo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.custo_unitario_aplicado is null then
    update public.osproduto op
       set custo_unitario_aplicado = p.ultimovalordecompra
      from public.produto p
     where op.ordemservicoid = new.ordemservicoid
       and op.produtoid = new.produtoid
       and p.id = new.produtoid;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_osproduto_snapshot_ultimo_custo on public.osproduto;
create trigger trg_osproduto_snapshot_ultimo_custo
after insert on public.osproduto
for each row execute function public.fn_osproduto_snapshot_ultimo_custo();

comment on column public.produto.ultimovalordecompra is
  'Valor unitario da compra mais recente; futuramente atualizado ao confirmar entrada fiscal.';
comment on column public.osproduto.custo_unitario_aplicado is
  'Snapshot do ultimo valor de compra ao inserir o produto na OS; NULL identifica item legado/sem custo.';
