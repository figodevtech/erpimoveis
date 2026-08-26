-- "Aluguel POS" como acrescimo E como desconto.
--
-- O aluguel da maquineta e cobrado pela adquirente e aparece de dois jeitos,
-- que sao fatos financeiros diferentes:
--
--   DESCONTO   a adquirente desconta o aluguel do repasse. O bruto e o mesmo;
--              o que cai e o liquido. E o caso comum.
--   ACRESCIMO  o aluguel e repassado ao pagador dentro do valor cobrado. Sobe
--              o bruto.
--
-- Dois tipos, e nao um, porque a natureza e o que decide de que lado da conta a
-- linha entra — `tg_transacao_ajuste_recalcular` soma por natureza.
--
-- ONDE CADA UM APARECE
-- Acrescimo mexe no bruto, e a trava de 20260806120000_travar_valor_apos_baixa
-- recusa isso depois da baixa. Por isso `tiposDisponiveis`, em ajustes-tab.tsx,
-- deixa so os DESCONTO quando o titulo ja foi baixado:
--
--   titulo pendente    ve os dois, separados na lista pelo "+" e pelo "−"
--   titulo liquidado   ve so o desconto
--
-- E isso serve bem ao caso comum: o aluguel costuma aparecer no extrato da
-- adquirente depois de o recebimento ja ter sido baixado.
--
-- O NOME REPETIDO E DE PROPOSITO
-- Os dois se chamam "Aluguel POS" na tela porque, para quem lanca, e a mesma
-- despesa; o que muda e o sinal, que a propria lista mostra. So o `codigo`
-- precisa ser unico, e ele segue a convencao ja usada em IMPOSTOS /
-- IMPOSTOS_DESCONTO: a natureza no fim, quando ha o par.
BEGIN;

INSERT INTO public.tipos_ajuste_transacao (codigo, nome, natureza, codigo_sistema, descricao)
VALUES
  ('ALUGUEL_POS', 'Aluguel POS', 'ACRESCIMO', NULL,
   'Aluguel da maquineta repassado ao pagador dentro do valor cobrado.'),
  ('ALUGUEL_POS_DESCONTO', 'Aluguel POS', 'DESCONTO', NULL,
   'Aluguel da maquineta descontado pela adquirente do valor recebido.')
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
