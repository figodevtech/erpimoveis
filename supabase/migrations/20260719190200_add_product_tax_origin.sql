ALTER TABLE public.produto
  ADD COLUMN IF NOT EXISTS origem_mercadoria text;

ALTER TABLE public.produto
  DROP CONSTRAINT IF EXISTS produto_origem_mercadoria_check;
ALTER TABLE public.produto
  ADD CONSTRAINT produto_origem_mercadoria_check
  CHECK (origem_mercadoria IS NULL OR origem_mercadoria ~ '^[0-8]$');

ALTER TABLE public.nfe_item
  ADD COLUMN IF NOT EXISTS origem_mercadoria text;
ALTER TABLE public.nfe_item
  DROP CONSTRAINT IF EXISTS nfe_item_origem_mercadoria_check;
ALTER TABLE public.nfe_item
  ADD CONSTRAINT nfe_item_origem_mercadoria_check
  CHECK (origem_mercadoria IS NULL OR origem_mercadoria ~ '^[0-8]$');

COMMENT ON COLUMN public.produto.origem_mercadoria IS
  'Origem fiscal explícita da mercadoria, código oficial 0 a 8; não inferir pelo fornecedor.';
