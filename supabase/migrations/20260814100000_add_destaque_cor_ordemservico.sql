ALTER TABLE public.ordemservico
  ADD COLUMN IF NOT EXISTS destaque_cor character varying(20) NOT NULL DEFAULT 'vermelho';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ordemservico_destaque_cor_chk'
      AND conrelid = 'public.ordemservico'::regclass
  ) THEN
    ALTER TABLE public.ordemservico
      ADD CONSTRAINT ordemservico_destaque_cor_chk
      CHECK (destaque_cor IN ('vermelho', 'amarelo'));
  END IF;
END
$$;

COMMENT ON COLUMN public.ordemservico.destaque_cor IS
  'Highlight color for the service order: vermelho or amarelo.';
