alter table public.vendaproduto
  add column if not exists custo_unitario_aplicado numeric(14,2);

alter table public.vendaproduto
  drop constraint if exists vendaproduto_custo_unitario_aplicado_nonnegative;
alter table public.vendaproduto
  add constraint vendaproduto_custo_unitario_aplicado_nonnegative
  check (custo_unitario_aplicado is null or custo_unitario_aplicado >= 0) not valid;

create or replace function public.fn_vendaproduto_snapshot_ultimo_custo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.custo_unitario_aplicado is null then
    select p.ultimovalordecompra
      into new.custo_unitario_aplicado
      from public.produto p
     where p.id = new.produtoid;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vendaproduto_snapshot_ultimo_custo on public.vendaproduto;
create trigger trg_vendaproduto_snapshot_ultimo_custo
before insert on public.vendaproduto
for each row execute function public.fn_vendaproduto_snapshot_ultimo_custo();

comment on column public.vendaproduto.custo_unitario_aplicado is
  'Snapshot do ultimo valor de compra ao inserir o produto na venda; NULL identifica item legado/sem custo.';
