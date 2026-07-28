-- Uma NF-e pode ter nova entrada somente quando todas as entradas anteriores
-- com a mesma chave/documento estiverem canceladas.
BEGIN;

DROP INDEX IF EXISTS public.entrada_notachave_valida_unique;
CREATE UNIQUE INDEX entrada_notachave_valida_unique
  ON public.entrada(notachave)
  WHERE fiscal
    AND status = 'CONFIRMADA'::public.enum_status_entrada
    AND notachave ~ '^[0-9]{44}$';

DROP INDEX IF EXISTS public.entrada_fiscal_dfe_documento_unique;
CREATE UNIQUE INDEX entrada_fiscal_dfe_documento_unique
  ON public.entrada(fiscal_dfe_documento_id)
  WHERE fiscal_dfe_documento_id IS NOT NULL
    AND status = 'CONFIRMADA'::public.enum_status_entrada;

COMMIT;
