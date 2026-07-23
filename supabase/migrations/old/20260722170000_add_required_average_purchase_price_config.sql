alter table public.config_geral
  add column if not exists produto_preco_medio_compra_obrigatorio boolean not null default false;

comment on column public.config_geral.produto_preco_medio_compra_obrigatorio is
  'Define se o valor medio de compra, maior que zero, e obrigatorio no cadastro e na edicao de produtos.';
