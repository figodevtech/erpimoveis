ALTER TABLE public.config_geral
  ADD COLUMN IF NOT EXISTS setor_padrao_os_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'config_geral_setor_padrao_os_id_fkey'
      AND conrelid = 'public.config_geral'::regclass
  ) THEN
    ALTER TABLE public.config_geral
      ADD CONSTRAINT config_geral_setor_padrao_os_id_fkey
      FOREIGN KEY (setor_padrao_os_id)
      REFERENCES public.setor(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

COMMENT ON COLUMN public.config_geral.setor_padrao_os_id IS
  'Default sector selected when creating a service order.';
