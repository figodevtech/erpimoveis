-- Nova forma de pagamento: Promissória. Funciona igual a Boleto — inclusive
-- parcela — e a diferença entre as duas é só o instrumento de cobrança que o
-- cliente assinou, não uma regra financeira nova.
--
-- Fica em arquivo próprio, sem usar o valor em nada aqui, de propósito: o
-- Postgres recusa usar um valor de enum (num CHECK, por exemplo) na mesma
-- transação em que ele foi adicionado. `20260903220000_promissoria_parcelavel`
-- é quem estende `ordemservico_parcelas_compativel_forma` para aceitá-la, já
-- em migration separada, depois deste valor estar commitado.
alter type public.metodo_pagamento add value if not exists 'PROMISSORIA';
