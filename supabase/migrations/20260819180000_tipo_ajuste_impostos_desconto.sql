-- "Impostos" tambem como DESCONTO, ao lado do acrescimo de 20260819120000.
--
-- POR QUE OS DOIS
-- Tributo aparece dos dois lados de um recebimento, e sao fatos diferentes:
--
--   ACRESCIMO  o imposto entra no que o pagador deve. Sobe o bruto.
--   DESCONTO   o imposto e retido na fonte e nunca chega a conta. O bruto e o
--              mesmo; o que cai e o liquido.
--
-- Um tipo so nao daria conta: a natureza e o que decide de que lado da conta a
-- linha entra, e `tg_transacao_ajuste_recalcular` soma por natureza.
--
-- ONDE CADA UM APARECE
-- Acrescimo mexe no bruto, e a trava de 20260806120000_travar_valor_apos_baixa
-- recusa isso depois da baixa — por isso `tiposDisponiveis`, em ajustes-tab.tsx,
-- filtra so os DESCONTO quando o titulo ja foi baixado. Na pratica:
--
--   titulo pendente    ve os dois, separados na lista pelo "+" e pelo "−"
--   titulo liquidado   ve so este, o desconto
--
-- E o caso comum: a retencao costuma ser conhecida quando o dinheiro cai, ja
-- com o titulo baixado. Sem esta linha, imposto retido so caberia em "Outro
-- desconto" — que e onde ele estava indo parar ate agora.
--
-- O NOME REPETIDO E DE PROPOSITO
-- Os dois se chamam "Impostos" na tela porque, para quem lanca, e a mesma
-- palavra; o que muda e o sinal, que a propria lista mostra. O `codigo` e que
-- precisa ser unico, e ele segue a convencao ja usada em OUTRO_ACRESCIMO /
-- OUTRO_DESCONTO: a natureza no fim.
BEGIN;

INSERT INTO public.tipos_ajuste_transacao (codigo, nome, natureza, codigo_sistema, descricao)
VALUES ('IMPOSTOS_DESCONTO', 'Impostos', 'DESCONTO', NULL,
        'Tributos retidos na fonte, abatidos do valor recebido.')
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
