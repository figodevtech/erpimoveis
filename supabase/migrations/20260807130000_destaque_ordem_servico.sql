ALTER TABLE public.ordemservico
  ADD COLUMN IF NOT EXISTS destacada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS destaque_motivo character varying(200),
  ADD COLUMN IF NOT EXISTS destacada_por uuid,
  ADD COLUMN IF NOT EXISTS destacada_em timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ordemservico_destacada_por_fkey'
      AND conrelid = 'public.ordemservico'::regclass
  ) THEN
    ALTER TABLE public.ordemservico
      ADD CONSTRAINT ordemservico_destacada_por_fkey
      FOREIGN KEY (destacada_por)
      REFERENCES public.usuario(id);
  END IF;
END
$$;

ALTER TABLE public.ordemservico
  DROP CONSTRAINT IF EXISTS ordemservico_destaque_consistente_chk;

ALTER TABLE public.ordemservico
  ADD CONSTRAINT ordemservico_destaque_consistente_chk
  CHECK (
    (
      destacada = true
      AND NULLIF(BTRIM(destaque_motivo), '') IS NOT NULL
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

COMMENT ON COLUMN public.ordemservico.destacada IS
  'Indicates that the service order requires visual attention.';
COMMENT ON COLUMN public.ordemservico.destaque_motivo IS
  'Reason informed when the service order was highlighted.';
COMMENT ON COLUMN public.ordemservico.destacada_por IS
  'User who last highlighted the service order.';
COMMENT ON COLUMN public.ordemservico.destacada_em IS
  'Date and time when the service order was last highlighted.';
