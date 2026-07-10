alter table public.ordemservico
add column if not exists subtotal numeric not null default 0,
add column if not exists desconto_tipo public.enum_tipo_desconto_venda,
add column if not exists desconto numeric not null default 0;

alter table public.osproduto
add column if not exists desconto_tipo public.enum_tipo_desconto_venda,
add column if not exists desconto numeric not null default 0;

alter table public.osservico
add column if not exists desconto_tipo public.enum_tipo_desconto_venda,
add column if not exists desconto numeric not null default 0;

update public.ordemservico
set subtotal = orcamentototal
where subtotal = 0
  and orcamentototal <> 0;
