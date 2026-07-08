ALTER TABLE public.produto
  ADD COLUMN IF NOT EXISTS etiqueta text,
  ADD COLUMN IF NOT EXISTS local text;

CREATE INDEX IF NOT EXISTS idx_produto_etiqueta ON public.produto (etiqueta);
CREATE INDEX IF NOT EXISTS idx_produto_local ON public.produto (local);
