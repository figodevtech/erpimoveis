-- Promissória parcela igual a boleto e crédito: estende a trava que hoje só
-- deixa `ordemservico.parcelas_pagamento` preenchido quando a forma é uma
-- dessas duas.
BEGIN;

ALTER TABLE public.ordemservico
  DROP CONSTRAINT IF EXISTS ordemservico_parcelas_compativel_forma;

ALTER TABLE public.ordemservico
  ADD CONSTRAINT ordemservico_parcelas_compativel_forma
  CHECK (
    parcelas_pagamento IS NULL
    OR forma_pagamento IN ('CREDITO', 'BOLETO', 'PROMISSORIA')
  );

COMMIT;
