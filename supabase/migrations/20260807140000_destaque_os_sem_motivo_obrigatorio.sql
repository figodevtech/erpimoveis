ALTER TABLE public.ordemservico
  DROP CONSTRAINT IF EXISTS ordemservico_destaque_consistente_chk;

ALTER TABLE public.ordemservico
  ADD CONSTRAINT ordemservico_destaque_consistente_chk
  CHECK (
    (
      destacada = true
      AND destacada_por IS NOT NULL
      AND destacada_em IS NOT NULL
    )
    OR
    (
      destacada = false
      AND destaque_motivo IS NULL
      AND destacada_por IS NULL
      AND destacada_em IS NULL
    )
  );

COMMENT ON CONSTRAINT ordemservico_destaque_consistente_chk
  ON public.ordemservico IS
  'A highlighted service order requires author and timestamp; its reason may be filled by autosave.';
