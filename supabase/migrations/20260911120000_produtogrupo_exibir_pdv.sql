BEGIN;

-- Preserva a visibilidade atual dos grupos existentes e dos novos cadastros.
ALTER TABLE public.produtogrupo
  ADD COLUMN IF NOT EXISTS "exibirPdv" boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.produtogrupo."exibirPdv" IS
  'Quando false, oculta todos os produtos do grupo no PDV, independentemente de produto.exibirPdv. Quando true, respeita a flag individual do produto.';

COMMIT;
