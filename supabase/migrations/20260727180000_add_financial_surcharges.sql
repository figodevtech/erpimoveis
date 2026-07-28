alter table public.venda
  add column if not exists acrescimo_financeiro_tipo public.enum_tipo_desconto_venda,
  add column if not exists acrescimo_financeiro_valor numeric(14,2) not null default 0;

alter table public.ordemservico
  add column if not exists acrescimo_financeiro_tipo public.enum_tipo_desconto_venda,
  add column if not exists acrescimo_financeiro_valor numeric(14,2) not null default 0;

alter table public.venda
  drop constraint if exists venda_acrescimo_financeiro_valor_check,
  add constraint venda_acrescimo_financeiro_valor_check
    check (
      acrescimo_financeiro_valor >= 0
      and (acrescimo_financeiro_tipo is distinct from 'PORCENTAGEM' or acrescimo_financeiro_valor <= 100)
    );

alter table public.ordemservico
  drop constraint if exists ordemservico_acrescimo_financeiro_valor_check,
  add constraint ordemservico_acrescimo_financeiro_valor_check
    check (
      acrescimo_financeiro_valor >= 0
      and (acrescimo_financeiro_tipo is distinct from 'PORCENTAGEM' or acrescimo_financeiro_valor <= 100)
    );

comment on column public.venda.acrescimo_financeiro_valor is
  'Acréscimo exclusivo da cobrança financeira; não altera itens ou valores fiscais.';
comment on column public.ordemservico.acrescimo_financeiro_valor is
  'Acréscimo exclusivo da cobrança financeira; não altera orçamento, itens ou valores fiscais.';
