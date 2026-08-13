-- A venda passa a mandar ao financeiro o mesmo que a OS manda.
--
-- Ao encerrar a execução de uma OS, o diálogo "Confirmar envio ao Financeiro"
-- (20260729100200 / 100300 / 100400) recolhe três coisas que o financeiro precisa
-- e que ninguém mais tem como saber depois: em que formas o cliente vai pagar e
-- em quantas parcelas, que orientação foi combinada na negociação, e qual a
-- garantia prometida.
--
-- A venda fechava sem nada disso. O PDV gravava só `forma_pagamento`, e como
-- texto corrido — "PIX: R$ 10,00, CREDITO: R$ 5,00" —, montado para ser lido por
-- humano. Dá para exibir, não dá para saber em quantas parcelas o crédito foi
-- combinado, nem o que o vendedor prometeu ao cliente.
--
-- As colunas são as mesmas da OS, com os mesmos nomes, para que as duas pontas
-- do financeiro se pareçam.
BEGIN;

ALTER TABLE public.venda
  ADD COLUMN IF NOT EXISTS garantia text,
  ADD COLUMN IF NOT EXISTS parcelas_pagamento integer,
  ADD COLUMN IF NOT EXISTS descricao_financeiro text,
  ADD COLUMN IF NOT EXISTS pagamentos_previstos jsonb;

ALTER TABLE public.venda
  DROP CONSTRAINT IF EXISTS venda_garantia_nao_vazia,
  DROP CONSTRAINT IF EXISTS venda_parcelas_pagamento_valida,
  DROP CONSTRAINT IF EXISTS venda_pagamentos_previstos_array;

ALTER TABLE public.venda
  ADD CONSTRAINT venda_garantia_nao_vazia
    CHECK (garantia IS NULL OR btrim(garantia) <> ''),
  ADD CONSTRAINT venda_parcelas_pagamento_valida
    CHECK (parcelas_pagamento IS NULL OR parcelas_pagamento BETWEEN 1 AND 12),
  ADD CONSTRAINT venda_pagamentos_previstos_array
    CHECK (
      pagamentos_previstos IS NULL
      OR jsonb_typeof(pagamentos_previstos) = 'array'
    );

-- A OS tem ainda `ordemservico_parcelas_compativel_forma`, exigindo que a forma
-- seja CREDITO ou BOLETO para haver parcelas. Aqui não dá: `venda.forma_pagamento`
-- não é uma forma só, é o resumo de várias ("PIX: R$ 10,00, CREDITO: R$ 5,00"),
-- e um CHECK teria de interpretar texto livre para decidir. Quem garante a regra
-- é a rota, que valida cada pagamento previsto antes de gravar — e é lá que a
-- forma existe como dado, não como frase.

COMMENT ON COLUMN public.venda.garantia IS
  'Informação de garantia registrada no fechamento da venda.';
COMMENT ON COLUMN public.venda.parcelas_pagamento IS
  'Quantidade prevista de parcelas quando há uma única forma parcelável (credito ou boleto).';
COMMENT ON COLUMN public.venda.descricao_financeiro IS
  'Orientações livres deixadas ao financeiro no fechamento da venda.';
COMMENT ON COLUMN public.venda.pagamentos_previstos IS
  'Snapshot das formas de pagamento previstas, seus valores e parcelas no fechamento da venda.';

COMMIT;
