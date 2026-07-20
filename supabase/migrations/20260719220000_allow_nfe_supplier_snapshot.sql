ALTER TABLE public.nfe
  DROP CONSTRAINT IF EXISTS ck_nfe_destinatario;

ALTER TABLE public.nfe
  ADD CONSTRAINT ck_nfe_destinatario CHECK (
    (
      clienteid IS NOT NULL
      AND fornecedorid IS NULL
      AND destinatario_snapshot IS NULL
    )
    OR (
      clienteid IS NULL
      AND fornecedorid IS NOT NULL
      AND destinatario_snapshot IS NULL
    )
    OR (
      clienteid IS NULL
      AND fornecedorid IS NULL
      AND destinatario_snapshot IS NOT NULL
    )
    OR (
      clienteid IS NOT NULL
      AND fornecedorid IS NULL
      AND destinatario_snapshot IS NOT NULL
    )
    OR (
      clienteid IS NULL
      AND fornecedorid IS NOT NULL
      AND destinatario_snapshot IS NOT NULL
    )
  );
