alter table public.venda
  drop constraint if exists venda_desconto_financeiro_limites_check,
  add constraint venda_desconto_financeiro_limites_check check (
    coalesce(desconto_valor, 0) >= 0
    and (desconto_tipo is distinct from 'PORCENTAGEM' or coalesce(desconto_valor, 0) <= 100)
    and (desconto_tipo is distinct from 'FIXO' or coalesce(desconto_valor, 0) <= coalesce(sub_total, valortotal, 0))
  ) not valid;

alter table public.ordemservico
  drop constraint if exists ordemservico_desconto_financeiro_limites_check,
  add constraint ordemservico_desconto_financeiro_limites_check check (
    coalesce(desconto, 0) >= 0
    and (desconto_tipo is distinct from 'PORCENTAGEM' or coalesce(desconto, 0) <= 100)
    and (desconto_tipo is distinct from 'FIXO' or coalesce(desconto, 0) <= coalesce(subtotal, orcamentototal, 0))
  ) not valid;

alter table public.osproduto
  drop constraint if exists osproduto_desconto_limites_check,
  add constraint osproduto_desconto_limites_check check (
    coalesce(desconto, 0) >= 0
    and (desconto_tipo is distinct from 'PORCENTAGEM' or coalesce(desconto, 0) <= 100)
    and (desconto_tipo is distinct from 'FIXO' or coalesce(desconto, 0) <= coalesce(quantidade, 0) * coalesce(precounitario, 0))
  ) not valid;

alter table public.osservico
  drop constraint if exists osservico_desconto_limites_check,
  add constraint osservico_desconto_limites_check check (
    coalesce(desconto, 0) >= 0
    and (desconto_tipo is distinct from 'PORCENTAGEM' or coalesce(desconto, 0) <= 100)
    and (desconto_tipo is distinct from 'FIXO' or coalesce(desconto, 0) <= coalesce(quantidade, 0) * coalesce(precounitario, 0))
  ) not valid;
