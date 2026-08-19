alter table public.config_geral
  add column if not exists produto_ncm_obrigatorio boolean not null default false;

comment on column public.config_geral.produto_ncm_obrigatorio is
  'Define se o NCM, com os 8 digitos, e obrigatorio no cadastro e na edicao de produtos.';
