-- Preco unitario da NF-e nao cabia em cinco digitos.
--
-- nfe_item.valor_unitario estava como numeric(14,10): dez casas decimais
-- comiam quase toda a precisao e sobravam apenas quatro digitos inteiros,
-- teto de R$ 9.999,9999999999. Emitir uma OS ou venda com qualquer item de
-- R$ 10.000,00 para cima abortava o insert com "numeric field overflow"
-- antes mesmo de o rascunho ser gravado.
--
-- O leiaute 4.00 define vUnCom (e vUnTrib) como 11v0-10: ate onze digitos
-- inteiros e ate dez decimais. numeric(21,10) e o tipo que cobre o campo
-- inteiro, mantendo as dez casas que o motor ja emite em formatNumber(_, 10).
--
-- Era a unica coluna monetaria do banco incapaz de guardar R$ 10.000.
--
-- Sem clausula USING de proposito: alargar a precisao mantendo a escala e uma
-- mudanca que o Postgres reconhece como inofensiva e resolve sem reescrever a
-- tabela. Um USING explicito forcaria o rewrite completo sem ganho nenhum.
BEGIN;

ALTER TABLE public.nfe_item
  ALTER COLUMN valor_unitario TYPE numeric(21,10);

COMMIT;
