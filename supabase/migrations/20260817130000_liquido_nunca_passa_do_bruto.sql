-- Gravar o bruto de uma transacao com acrescimo deixava o liquido maior que ele.
--
-- CASO REAL — transacao 366 do Demir
-- Bruto R$ 666,67, com uma taxa de recebimento de R$ 25,73 (liquido 640,94). O
-- usuario queria: tirar a taxa e lancar juros de R$ 55,53, ficando com face de
-- R$ 666,67 e recebimento de R$ 722,20.
--
-- Pela aba "Acrescimos e descontos" isso funciona:
--
--   passo 1  excluir a taxa      bruto=666,67  face=666,67  liquido=666,67
--   passo 2  lancar os juros     bruto=722,20  face=666,67  liquido=722,20   OK
--
-- O estrago vem de uma terceira escrita, quando alguma tela grava `valor` de
-- novo — o campo "Valor bruto" da aba Detalhes, ou o rateio. Gravando 666,67
-- (que e o numero que a pessoa tem na cabeca como "o valor"):
--
--   passo 3  gravar valor=666,67 bruto=666,67  face=611,14  liquido=722,20
--
-- Duas coisas erradas de uma vez:
--
--   1. A face virou 611,14 (= 666,67 - 55,53). `tg_transacao_valor_coerente`
--      entende toda escrita de `valor` como "este e o total, com juros dentro",
--      e reparte para tras. E a face e o que abate a OS ou a venda.
--
--   2. O liquido ficou em 722,20 — MAIOR que o bruto de 666,67. O gatilho so
--      recalcula o liquido quando ha desconto lancado; sem desconto ele fica
--      como estava, e nada impede que ultrapasse o bruto.
--
-- ESTA MIGRATION RESOLVE O ITEM 2.
-- Sem desconto lancado o liquido continua livre, como sempre foi — registro
-- anterior as linhas de ajuste guardava a taxa direto nele, e forcar igualdade
-- apagaria esse historico. O que passa a valer e um teto: liquido nunca maior
-- que o bruto. E o mesmo invariante que a tela ja cobra ao salvar
-- ("O valor liquido nao pode ser maior que o bruto"), que ate aqui o banco nao
-- garantia.
--
-- O item 1 e ambiguidade de significado, nao de calculo: com juros lancados,
-- "valor bruto" pode querer dizer a face ou o total, e o sistema nao tem como
-- adivinhar. Tratado na tela, travando o campo quando ha acrescimo — do mesmo
-- jeito que o liquido ja e travado quando ha mais de um desconto.
--
-- Nenhum dos quatro bancos tem registro nesse estado hoje (verificado): isto e
-- prevencao, nao correcao de historico.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_transacao_valor_coerente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF new.valor IS DISTINCT FROM old.valor THEN
    new.valor_base := round(coalesce(new.valor, 0) - coalesce(new.valor_acrescimos, 0), 2);
  END IF;

  -- Havendo desconto lancado, o liquido e resultado, nao entrada: qualquer valor
  -- que o chamador tenha mandado seria uma segunda verdade sobre o mesmo numero.
  IF coalesce(new.valor_descontos, 0) > 0 THEN
    new."valorLiquido" := round(coalesce(new.valor, 0) - new.valor_descontos, 2);

  -- Sem desconto lancado o liquido segue livre — e assim que os registros
  -- antigos guardam a taxa da maquineta. Livre ate o bruto, nao alem dele:
  -- receber liquido mais do que o valor da transacao nao existe.
  ELSIF coalesce(new."valorLiquido", 0) > coalesce(new.valor, 0) THEN
    new."valorLiquido" := new.valor;
  END IF;

  RETURN new;
END;
$$;

ALTER FUNCTION public.tg_transacao_valor_coerente() OWNER TO postgres;

COMMENT ON FUNCTION public.tg_transacao_valor_coerente() IS
  'Mantem valor_base, valor e valorLiquido coerentes entre si em toda escrita na transacao. O liquido nunca passa do bruto.';

COMMIT;
