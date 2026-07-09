ALTER TABLE public.produto
  ADD COLUMN IF NOT EXISTS etiqueta text,
  ADD COLUMN IF NOT EXISTS local text;

DROP INDEX IF EXISTS public.idx_produto_etiqueta;

CREATE UNIQUE INDEX IF NOT EXISTS idx_produto_etiqueta_unique
  ON public.produto (etiqueta)
  WHERE etiqueta IS NOT NULL AND btrim(etiqueta) <> '';

CREATE INDEX IF NOT EXISTS idx_produto_local ON public.produto (local);
