alter table public.lotes
  add column if not exists valor_compra numeric(14, 2) not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lotes_valor_compra_nonnegative'
      and conrelid = 'public.lotes'::regclass
  ) then
    alter table public.lotes
      add constraint lotes_valor_compra_nonnegative check (valor_compra >= 0);
  end if;
end
$$;

comment on column public.lotes.valor_compra is
  'Valor de aquisição do veículo/lote de desmanche.';
