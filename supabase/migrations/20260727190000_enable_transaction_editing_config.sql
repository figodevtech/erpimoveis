alter table public.config_geral
  add column if not exists habilitar_edicao_transacoes boolean not null default false;

comment on column public.config_geral.habilitar_edicao_transacoes is
  'Permite editar transações financeiras já cadastradas.';
